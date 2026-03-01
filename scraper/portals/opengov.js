// Goose Creek -- OpenGov Permit Portal Scraper
// Portal: https://goosecreeksc.portal.opengov.com
// OpenGov is a React SPA with a REST API backend.
// Strategy: Try REST API patterns, fall back to Puppeteer.

const puppeteer = require('puppeteer');
const axios = require('axios');
const config = require('../../config');
const utils = require('../utils');

const municipalityConfig = config.municipalities.gooseCreek;
const PORTAL_BASE = 'https://goosecreeksc.portal.opengov.com';

// Common OpenGov API patterns
const API_PATHS = [
  '/api/records',
  '/api/v1/records',
  '/api/permits',
  '/api/v1/permits',
  '/api/records/search',
];

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

    utils.log(`[Goose Creek] Starting OpenGov scrape -- ${dateRange.from} to ${dateRange.to}`);

    const permits = [];
    const headers = {
      'User-Agent': utils.getRandomUserAgent(),
      'Accept': 'application/json',
    };

    // Try API-first approach
    for (const apiPath of API_PATHS) {
      try {
        const resp = await axios.get(`${PORTAL_BASE}${apiPath}`, {
          params: {
            type: 'building',
            category: 'permit',
            startDate: dateRange.from,
            endDate: dateRange.to,
            pageSize: 100,
          },
          headers,
          timeout: 15000,
        });

        const data = resp.data;
        const records = Array.isArray(data) ? data : (data?.results || data?.records || data?.data || []);

        if (records.length > 0) {
          utils.log(`[Goose Creek] API hit at ${apiPath}: ${records.length} records`);

          for (const record of records) {
            const value = utils.parseDollarValue(
              record.value || record.projectValue || record.estimatedCost || record.valuation
            );
            if (value !== null && value < minValue) continue;

            const permit = utils.createPermitRecord({
              permit_number: record.recordNumber || record.permitNumber || record.number || record.id,
              address: record.address || record.location || record.siteAddress || record.formattedAddress,
              municipality: municipalityConfig.name,
              builder_name: record.contractor || record.applicant || record.builderName,
              builder_company: record.contractorCompany || record.companyName,
              owner_name: record.owner || record.ownerName || record.propertyOwner,
              project_value: value,
              permit_type: record.type || record.recordType || record.category,
              inspection_type: record.inspectionType || record.subType,
              inspection_date: record.inspectionDate || record.lastUpdated || record.submittedDate,
              inspection_status: record.status || record.inspectionStatus,
              permit_issue_date: record.issueDate || record.issuedDate || record.approvedDate,
              source_url: `${PORTAL_BASE}/records/${record.id || record.recordNumber || ''}`,
              raw_data: { source: 'opengov-api', ...record },
            });
            permits.push(permit);
          }
          break;
        }
      } catch (e) { continue; }
    }

    // Fallback to Puppeteer if API didn't work
    if (permits.length === 0) {
      let browser;
      try {
        browser = await puppeteer.launch(config.scraper.puppeteer);
        const page = await browser.newPage();
        await page.setUserAgent(utils.getRandomUserAgent());
        page.setDefaultTimeout(config.scraper.pageTimeoutMs);

        // Intercept API calls for endpoint discovery
        const discoveredApis = [];
        page.on('response', async (response) => {
          const url = response.url();
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json') && (url.includes('api') || url.includes('record') || url.includes('permit'))) {
            discoveredApis.push(url);
          }
        });

        utils.log('[Goose Creek] Loading OpenGov portal via Puppeteer...');
        await page.goto(PORTAL_BASE, { waitUntil: 'networkidle2', timeout: 45000 });
        await utils.delay(4000);

        // Click into permits section
        const navSelectors = [
          'a[href*="permit"]', 'a[href*="building"]',
          'button:has-text("Permits")', 'a:has-text("Permits")',
          'a:has-text("Building")',
        ];

        for (const sel of navSelectors) {
          try {
            const el = await page.$(sel);
            if (el) {
              await el.click();
              await utils.delay(3000);
              break;
            }
          } catch (e) { /* next */ }
        }

        // Parse visible results
        const rows = await page.$$eval(
          'table tr, [class*="record"], [class*="result"], [class*="card"], [class*="list-item"]',
          elements => elements.map(el => ({
            text: el.textContent.trim().substring(0, 500),
            link: el.querySelector('a')?.href || null,
          }))
        );

        for (const row of rows) {
          if (!row.text || row.text.length < 10) continue;
          const valueMatch = row.text.match(/\$[\d,]+\.?\d*/);
          const value = valueMatch ? utils.parseDollarValue(valueMatch[0]) : null;
          const permitMatch = row.text.match(/\b(BLD|BP|PMT|RES|COM|BLDG|GC)[-\s]?\d{2,}[-\s]?\d+\b/i);

          if (permitMatch || value) {
            permits.push(utils.createPermitRecord({
              permit_number: permitMatch ? permitMatch[0] : null,
              address: row.text.substring(0, 100),
              municipality: municipalityConfig.name,
              project_value: value,
              source_url: row.link || PORTAL_BASE,
              raw_data: { source: 'opengov-puppeteer' },
            }));
          }
        }

        if (discoveredApis.length > 0) {
          utils.log(`[Goose Creek] Discovered ${discoveredApis.length} APIs for future use`);
          discoveredApis.slice(0, 3).forEach(u => utils.log(`  -> ${u}`));
        }

        if (permits.length === 0) {
          await utils.saveScreenshot(page, 'goose-creek-results');
        }
      } catch (error) {
        utils.log(`[Goose Creek] Puppeteer error: ${error.message}`);
        throw error;
      } finally {
        if (browser) await browser.close();
      }
    }

    utils.log(`[Goose Creek] Scrape complete -- ${permits.length} permits found`);
    return permits;
  },
};
