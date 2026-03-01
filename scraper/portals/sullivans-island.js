// Sullivan's Island -- BS&A Online Permit Scraper
// BS&A Online is a server-rendered portal commonly used by small SC municipalities.
// Strategy: HTTP GET search page, parse results table via cheerio.
// Falls back to Charleston County scraper if BS&A portal is not available.

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../../config');
const utils = require('../utils');

const municipalityConfig = config.municipalities.sullivansIsland;

// BS&A Online common URL patterns for Sullivan's Island
const BSA_SEARCH_URLS = [
  'https://bsaonline.com/SiteSearch/SiteSearchResults?SearchCategory=Permit&SearchText=&installationID=606',
  'https://bsaonline.com/Permits/Search?installationID=606',
];

module.exports = {
  name: municipalityConfig.name,
  slug: municipalityConfig.slug,
  portalUrl: municipalityConfig.portalUrl,
  portalType: municipalityConfig.portalType,
  active: municipalityConfig.active,

  async scrape(options = {}) {
    const { dateFrom, dateTo } = options;
    const dateRange = dateFrom && dateTo
      ? { from: dateFrom, to: dateTo }
      : utils.getDateRange();

    utils.log(`[Sullivan's Island] Starting BS&A Online scrape -- ${dateRange.from} to ${dateRange.to}`);

    const permits = [];
    const headers = {
      'User-Agent': utils.getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    // Try to discover BS&A Online portal from the town website
    try {
      const townResp = await axios.get(municipalityConfig.portalUrl, {
        headers,
        timeout: 15000,
      });
      const $ = cheerio.load(townResp.data);

      // Look for BS&A or permit portal links
      let bsaUrl = null;
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().toLowerCase();
        if (
          href.includes('bsaonline') ||
          href.includes('bsa') ||
          (text.includes('permit') && (text.includes('search') || text.includes('portal') || text.includes('online')))
        ) {
          if (!bsaUrl) bsaUrl = href;
        }
      });

      if (bsaUrl) {
        utils.log(`[Sullivan's Island] Found BS&A portal link: ${bsaUrl}`);
        BSA_SEARCH_URLS.unshift(bsaUrl);
      }
    } catch (e) {
      utils.log(`[Sullivan's Island] Could not check town website: ${e.message}`);
    }

    // Try each potential BS&A URL
    for (const searchUrl of BSA_SEARCH_URLS) {
      try {
        utils.log(`[Sullivan's Island] Trying BS&A endpoint: ${searchUrl}`);

        const resp = await axios.get(searchUrl, {
          headers,
          timeout: 20000,
        });

        const $ = cheerio.load(resp.data);

        // BS&A typically renders results in a table with class "SearchResults" or similar
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
            if (text.includes('address') || text.includes('location')) colMap.address = i;
            if (text.includes('type')) colMap.type = i;
            if (text.includes('status')) colMap.status = i;
            if (text.includes('date')) colMap.date = colMap.date ?? i;
            if (text.includes('value') || text.includes('cost')) colMap.value = i;
            if (text.includes('owner') || text.includes('applicant')) colMap.owner = i;
          });

          // Parse data rows
          for (let r = 1; r < rows.length; r++) {
            const cells = $(rows[r]).find('td');
            if (cells.length < 2) continue;

            const cellText = (idx) => idx !== undefined ? $(cells[idx]).text().trim() : null;

            const permitNumber = cellText(colMap.permit_number);
            const address = cellText(colMap.address);
            if (!permitNumber && !address) continue;

            // Check date range if we can parse the date
            const dateStr = cellText(colMap.date);
            if (dateStr) {
              const parsed = utils.formatDate(dateStr);
              if (parsed && (parsed < dateRange.from || parsed > dateRange.to)) continue;
            }

            const permit = utils.createPermitRecord({
              permit_number: permitNumber,
              address: address || '',
              municipality: municipalityConfig.name,
              owner_name: cellText(colMap.owner),
              project_value: cellText(colMap.value),
              permit_type: cellText(colMap.type),
              inspection_status: cellText(colMap.status),
              inspection_date: dateStr,
              source_url: searchUrl,
              raw_data: { source: 'bsa-online' },
            });
            permits.push(permit);
          }

          if (permits.length > 0) break;
        }

        if (permits.length > 0) break;

      } catch (e) {
        utils.log(`[Sullivan's Island] BS&A endpoint failed: ${e.message}`);
      }
    }

    if (permits.length === 0) {
      utils.log("[Sullivan's Island] No permits found via BS&A -- permits may appear via Charleston County scraper");
    }

    utils.log(`[Sullivan's Island] Scrape complete -- ${permits.length} permits found`);
    return permits;
  },
};
