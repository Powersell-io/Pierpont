// Citizenserve Platform Scraper — Factory for multiple municipalities
// Covers: Isle of Palms, Kiawah, Seabrook, Summerville, Hardeeville
// Portal pattern: citizenserve.com/Portal/PortalController?CommunityType=Portal&installationID=XXX
//
// Citizenserve portals are server-rendered with standard HTML forms.
// Strategy: GET the permit search page, POST search with date range, parse results table.

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../../config');
const utils = require('../utils');

const BASE_URL = 'https://www.citizenserve.com';

// Create a scraper instance for a specific Citizenserve installation
function createCitizenserveScraper(municipalityKey) {
  const muniConfig = config.municipalities[municipalityKey];
  if (!muniConfig) throw new Error(`Municipality "${municipalityKey}" not found in config`);

  const installationId = muniConfig.citizenserveId;
  if (!installationId) throw new Error(`No citizenserveId for "${municipalityKey}"`);

  const portalUrl = `${BASE_URL}/Portal/PortalController?CommunityType=Portal&installationID=${installationId}`;

  return {
    name: muniConfig.name,
    slug: muniConfig.slug,
    portalUrl,
    portalType: 'citizenserve',
    active: muniConfig.active,

    async scrape(options = {}) {
      const { dateFrom, dateTo } = options;
      const dateRange = dateFrom && dateTo
        ? { from: dateFrom, to: dateTo }
        : utils.getDateRange();

      utils.log(`[${muniConfig.name}] Starting Citizenserve scrape (ID: ${installationId}) -- ${dateRange.from} to ${dateRange.to}`);

      const permits = [];
      const headers = {
        'User-Agent': utils.getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      };

      try {
        // Step 1: Load the portal to get session cookies and form tokens
        const session = axios.create({
          baseURL: BASE_URL,
          headers,
          timeout: 30000,
          maxRedirects: 5,
        });

        // Store cookies across requests
        let cookies = '';

        const portalResp = await session.get(`/Portal/PortalController`, {
          params: {
            CommunityType: 'Portal',
            installationID: installationId,
          },
        });

        // Capture set-cookie headers
        const setCookies = portalResp.headers['set-cookie'];
        if (setCookies) {
          cookies = setCookies.map(c => c.split(';')[0]).join('; ');
        }

        const $ = cheerio.load(portalResp.data);

        // Step 2: Find the permit search page link
        let searchUrl = null;
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          const text = $(el).text().toLowerCase();
          if (
            href.includes('permit') ||
            href.includes('Permit') ||
            href.includes('search') ||
            text.includes('permit') ||
            text.includes('building') ||
            text.includes('search')
          ) {
            if (!searchUrl && (href.startsWith('/') || href.startsWith('http'))) {
              searchUrl = href;
            }
          }
        });

        // Try common Citizenserve permit search paths
        const searchPaths = [
          `/Portal/PortalController?CommunityType=Portal&installationID=${installationId}&itemID=0&typeID=0`,
          `/Portal/PortalController?CommunityType=Portal&installationID=${installationId}&Category=Permit`,
          searchUrl,
        ].filter(Boolean);

        let searchPage = null;
        for (const path of searchPaths) {
          try {
            const fullUrl = path.startsWith('http') ? path : `${BASE_URL}${path}`;
            const resp = await session.get(fullUrl, {
              headers: { ...headers, Cookie: cookies },
            });
            const page$ = cheerio.load(resp.data);

            // Check if this page has a results table or search form
            if (page$('table').length > 0 || page$('form').length > 0) {
              searchPage = { html: resp.data, url: fullUrl };

              // Update cookies
              const sc = resp.headers['set-cookie'];
              if (sc) cookies = sc.map(c => c.split(';')[0]).join('; ');
              break;
            }
          } catch (e) { /* try next */ }
        }

        if (!searchPage) {
          utils.log(`[${muniConfig.name}] Could not locate permit search page`);
          return permits;
        }

        // Step 3: Check for login wall before parsing
        const page$ = cheerio.load(searchPage.html);

        // Detect login-walled pages — if we see a login form, bail out
        const hasLoginForm = page$('input[type="password"]').length > 0
          || page$('form').toArray().some(f => {
            const text = page$(f).text().toLowerCase();
            return text.includes('login') || text.includes('sign in') || text.includes('user name');
          });

        if (hasLoginForm) {
          utils.log(`[${muniConfig.name}] Citizenserve portal is login-walled — skipping`);
          return permits;
        }

        // Form label strings that should never be treated as permit data
        const FORM_LABELS = new Set([
          'address:', 'address1:', 'address2:', 'city:', 'state:', 'zip:',
          'name:', 'phone:', 'email:', 'password:', 'username:', 'user name:',
          'county:', 'country:', 'fax:', 'submit', 'cancel', 'update',
        ]);

        function isFormLabel(text) {
          if (!text) return true;
          const t = text.trim().toLowerCase();
          return FORM_LABELS.has(t) || (t.endsWith(':') && t.length < 20);
        }

        // Citizenserve typically renders results in a table
        const tables = page$('table');
        for (let t = 0; t < tables.length; t++) {
          const table = page$(tables[t]);
          const headerRow = table.find('tr').first();
          const headerCells = headerRow.find('th, td');

          // Map column indices to field names
          const colMap = {};
          headerCells.each((i, el) => {
            const text = page$(el).text().trim().toLowerCase();
            if (text.includes('permit') && text.includes('number')) colMap.permit_number = i;
            else if (text.includes('number') || text.includes('#')) colMap.permit_number = colMap.permit_number ?? i;
            if (text.includes('address') || text.includes('location')) colMap.address = i;
            if (text.includes('type')) colMap.permit_type = i;
            if (text.includes('status')) colMap.status = i;
            if (text.includes('date') && text.includes('issue')) colMap.issue_date = i;
            else if (text.includes('date')) colMap.date = colMap.date ?? i;
            if (text.includes('value') || text.includes('cost') || text.includes('amount')) colMap.value = i;
            if (text.includes('applicant') || text.includes('contractor') || text.includes('builder')) colMap.builder = i;
            if (text.includes('owner')) colMap.owner = i;
          });

          // Skip tables that look like form layouts (no meaningful header columns mapped)
          if (Object.keys(colMap).length < 2) continue;

          // Parse data rows
          const rows = table.find('tr').slice(1);
          rows.each((_, row) => {
            const cells = page$(row).find('td');
            if (cells.length < 2) return;

            const cellText = (idx) => idx !== undefined ? page$(cells[idx]).text().trim() : null;

            const permitNumber = cellText(colMap.permit_number);
            const address = cellText(colMap.address);
            if (!permitNumber && !address) return;

            // Skip rows where address or permit number is a form label
            if (isFormLabel(address) && isFormLabel(permitNumber)) return;

            const permit = utils.createPermitRecord({
              permit_number: permitNumber || `CS-${installationId}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
              address: address || '',
              municipality: muniConfig.name,
              builder_name: cellText(colMap.builder),
              owner_name: cellText(colMap.owner),
              project_value: cellText(colMap.value),
              permit_type: cellText(colMap.permit_type),
              inspection_status: cellText(colMap.status),
              inspection_date: cellText(colMap.date) || cellText(colMap.issue_date),
              permit_issue_date: cellText(colMap.issue_date),
              source_url: searchPage.url,
              raw_data: { source: 'citizenserve', installationId },
            });
            permits.push(permit);
          });

          if (permits.length > 0) break; // found data table
        }

        // Step 4: Also try to find individual permit links and follow them
        if (permits.length === 0) {
          const permitLinks = [];
          page$('a[href]').each((_, el) => {
            const href = page$(el).attr('href') || '';
            if (href.includes('permit') || href.includes('Permit') || href.includes('ViewCase') || href.includes('Detail')) {
              const text = page$(el).text().trim();
              if (text && text.length > 3) {
                permitLinks.push({ href, text });
              }
            }
          });

          utils.log(`[${muniConfig.name}] Found ${permitLinks.length} permit links to follow`);

          for (const link of permitLinks.slice(0, 50)) {
            try {
              const fullUrl = link.href.startsWith('http') ? link.href : `${BASE_URL}${link.href}`;
              const resp = await session.get(fullUrl, {
                headers: { ...headers, Cookie: cookies },
                timeout: 15000,
              });
              const detail$ = cheerio.load(resp.data);

              // Extract permit data from detail page
              const getField = (label) => {
                let value = null;
                detail$('td, th, label, span, div').each((_, el) => {
                  const t = detail$(el).text().trim().toLowerCase();
                  if (t.includes(label.toLowerCase())) {
                    const next = detail$(el).next();
                    if (next.length) value = next.text().trim();
                  }
                });
                return value;
              };

              const permit = utils.createPermitRecord({
                permit_number: getField('permit number') || getField('case number') || link.text,
                address: getField('address') || getField('location') || '',
                municipality: muniConfig.name,
                builder_name: getField('applicant') || getField('contractor'),
                owner_name: getField('owner'),
                project_value: getField('value') || getField('cost'),
                permit_type: getField('type') || getField('permit type'),
                inspection_status: getField('status'),
                inspection_date: getField('inspection date') || getField('date'),
                permit_issue_date: getField('issue date'),
                source_url: fullUrl,
                raw_data: { source: 'citizenserve', installationId, link: link.text },
              });

              if ((permit.permit_number || permit.address) && !isFormLabel(permit.address) && !isFormLabel(permit.permit_number)) {
                permits.push(permit);
              }

              await utils.delay(500); // rate limit
            } catch (e) { /* continue */ }
          }
        }

        utils.log(`[${muniConfig.name}] Citizenserve scrape complete -- ${permits.length} permits found`);

      } catch (error) {
        utils.log(`[${muniConfig.name}] Citizenserve scrape error: ${error.message}`);
        throw error;
      }

      return permits;
    },
  };
}

// Export individual scraper instances for each Citizenserve municipality
module.exports = {
  createCitizenserveScraper,
  // Pre-built instances for known installations
  isleOfPalms: createCitizenserveScraper('isleOfPalms'),
  kiawah: createCitizenserveScraper('kiawah'),
  seabrook: createCitizenserveScraper('seabrook'),
  summerville: createCitizenserveScraper('summerville'),
  hardeeville: createCitizenserveScraper('hardeeville'),
};
