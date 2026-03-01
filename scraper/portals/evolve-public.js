// Dorchester County -- Evolve Public Portal Scraper
// Portal: https://evolvepublic.infovisionsoftware.com/Dorchester/
// Evolve Public is a server-rendered portal. Strategy: axios + cheerio.

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../../config');
const utils = require('../utils');

const municipalityConfig = config.municipalities.dorchesterCounty;
const PORTAL_BASE = 'https://evolvepublic.infovisionsoftware.com/Dorchester';

module.exports = {
  name: municipalityConfig.name,
  slug: municipalityConfig.slug,
  portalUrl: municipalityConfig.portalUrl,
  portalType: municipalityConfig.portalType,
  active: municipalityConfig.active,

  async scrape(options = {}) {
    const { dateFrom, dateTo, minValue = config.scraper.minProjectValue } = options;
    const dateRange = dateFrom && dateTo
      ? { from: dateFrom, to: dateTo }
      : utils.getDateRange();

    utils.log(`[Dorchester Co.] Starting Evolve Public scrape -- ${dateRange.from} to ${dateRange.to}`);

    const permits = [];
    const headers = {
      'User-Agent': utils.getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    try {
      // Step 1: Load the portal home page
      const homeResp = await axios.get(PORTAL_BASE, {
        headers,
        timeout: 20000,
        maxRedirects: 5,
      });

      let cookies = '';
      const setCookies = homeResp.headers['set-cookie'];
      if (setCookies) {
        cookies = setCookies.map(c => c.split(';')[0]).join('; ');
      }

      const $ = cheerio.load(homeResp.data);

      // Step 2: Find permit search link
      let searchUrl = null;
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().toLowerCase();
        if (
          href.includes('Permit') || href.includes('permit') ||
          href.includes('Search') || href.includes('search') ||
          text.includes('permit') || text.includes('building')
        ) {
          if (!searchUrl) {
            searchUrl = href.startsWith('http') ? href : `${PORTAL_BASE}/${href.replace(/^\//, '')}`;
          }
        }
      });

      // Try common Evolve Public paths
      const searchUrls = [
        searchUrl,
        `${PORTAL_BASE}/Permit/Search`,
        `${PORTAL_BASE}/Permits`,
        `${PORTAL_BASE}/PermitSearch`,
        `${PORTAL_BASE}/Search`,
      ].filter(Boolean);

      for (const url of searchUrls) {
        try {
          utils.log(`[Dorchester Co.] Trying search URL: ${url}`);
          const resp = await axios.get(url, {
            headers: { ...headers, Cookie: cookies },
            timeout: 20000,
          });

          // Update cookies
          const sc = resp.headers['set-cookie'];
          if (sc) cookies = sc.map(c => c.split(';')[0]).join('; ');

          const page$ = cheerio.load(resp.data);

          // Try to submit a search form with date range
          const forms = page$('form');
          if (forms.length > 0) {
            const form = page$(forms[0]);
            const action = form.attr('action');
            if (action) {
              const formUrl = action.startsWith('http') ? action : `${PORTAL_BASE}/${action.replace(/^\//, '')}`;

              // Build form data
              const formData = new URLSearchParams();
              form.find('input, select').each((_, el) => {
                const name = page$(el).attr('name');
                const value = page$(el).val();
                if (name) formData.append(name, value || '');
              });

              // Try to set date fields
              const dateFields = ['StartDate', 'FromDate', 'dateFrom', 'start_date', 'IssueDateFrom'];
              for (const df of dateFields) {
                if (formData.has(df)) formData.set(df, dateRange.from);
              }
              const dateToFields = ['EndDate', 'ToDate', 'dateTo', 'end_date', 'IssueDateTo'];
              for (const df of dateToFields) {
                if (formData.has(df)) formData.set(df, dateRange.to);
              }

              try {
                const searchResp = await axios.post(formUrl, formData.toString(), {
                  headers: {
                    ...headers,
                    Cookie: cookies,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  timeout: 20000,
                });

                const result$ = cheerio.load(searchResp.data);
                const parsed = this.parseResultsTable(result$, municipalityConfig.name);
                if (parsed.length > 0) {
                  permits.push(...parsed);
                  break;
                }
              } catch (e) {
                utils.log(`[Dorchester Co.] Form submit failed: ${e.message}`);
              }
            }
          }

          // Parse results directly from the page if no form submission
          const parsed = this.parseResultsTable(page$, municipalityConfig.name);
          if (parsed.length > 0) {
            permits.push(...parsed);
            break;
          }

        } catch (e) {
          utils.log(`[Dorchester Co.] Search URL failed: ${e.message}`);
        }
      }

    } catch (error) {
      utils.log(`[Dorchester Co.] Evolve Public scrape error: ${error.message}`);
      throw error;
    }

    utils.log(`[Dorchester Co.] Scrape complete -- ${permits.length} permits found`);
    return permits;
  },

  // Parse results table from any Evolve Public page
  parseResultsTable($, municipalityName) {
    const permits = [];
    const tables = $('table');

    for (let t = 0; t < tables.length; t++) {
      const table = $(tables[t]);
      const rows = table.find('tr');
      if (rows.length < 2) continue;

      // Map headers
      const headerCells = $(rows[0]).find('th, td');
      const colMap = {};
      headerCells.each((i, el) => {
        const text = $(el).text().trim().toLowerCase();
        if (text.includes('permit') && (text.includes('no') || text.includes('#') || text.includes('number'))) colMap.permit_number = i;
        else if ((text.includes('number') || text.includes('#')) && colMap.permit_number === undefined) colMap.permit_number = i;
        if (text.includes('address') || text.includes('location') || text.includes('site')) colMap.address = i;
        if (text.includes('type') && !text.includes('inspect')) colMap.type = i;
        if (text.includes('status')) colMap.status = i;
        if (text.includes('issue') && text.includes('date')) colMap.issue_date = i;
        else if (text.includes('date') && colMap.date === undefined) colMap.date = i;
        if (text.includes('value') || text.includes('cost') || text.includes('valuation')) colMap.value = i;
        if (text.includes('owner')) colMap.owner = i;
        if (text.includes('contractor') || text.includes('builder') || text.includes('applicant')) colMap.builder = i;
      });

      // Need at least permit number or address column
      if (colMap.permit_number === undefined && colMap.address === undefined) continue;

      for (let r = 1; r < rows.length; r++) {
        const cells = $(rows[r]).find('td');
        if (cells.length < 2) continue;

        const cellText = (idx) => idx !== undefined && idx < cells.length ? $(cells[idx]).text().trim() : null;
        const cellLink = (idx) => idx !== undefined && idx < cells.length ? $(cells[idx]).find('a').attr('href') : null;

        const permitNumber = cellText(colMap.permit_number);
        const address = cellText(colMap.address);
        if (!permitNumber && !address) continue;

        const link = cellLink(colMap.permit_number) || cellLink(colMap.address);
        const sourceUrl = link ? (link.startsWith('http') ? link : `${PORTAL_BASE}/${link.replace(/^\//, '')}`) : PORTAL_BASE;

        const permit = utils.createPermitRecord({
          permit_number: permitNumber,
          address: address || '',
          municipality: municipalityName,
          builder_name: cellText(colMap.builder),
          owner_name: cellText(colMap.owner),
          project_value: cellText(colMap.value),
          permit_type: cellText(colMap.type),
          inspection_status: cellText(colMap.status),
          inspection_date: cellText(colMap.date) || cellText(colMap.issue_date),
          permit_issue_date: cellText(colMap.issue_date),
          source_url: sourceUrl,
          raw_data: { source: 'evolve-public' },
        });
        permits.push(permit);
      }

      if (permits.length > 0) break;
    }

    return permits;
  },
};
