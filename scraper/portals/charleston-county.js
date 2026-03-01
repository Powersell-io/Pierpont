// Charleston County — County-level permit scraper (catch-all)
// Portal: https://www.charlestoncounty.org/departments/building-inspection-services/
// This is the fallback scraper that also covers Sullivan's Island, IOP, Kiawah, Seabrook
const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../../config');
const utils = require('../utils');

const municipalityConfig = config.municipalities.charlestonCounty;

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

    utils.log(`🏛️  [Charleston County] Starting scrape — ${dateRange.from} to ${dateRange.to}, min value: $${minValue.toLocaleString()}`);

    const permits = [];
    let browser;

    try {
      // First, try to discover the actual permit search portal from the county website
      utils.log('[Charleston County] Checking county building inspection page for portal links...');

      const portalUrl = await this.discoverPortalUrl();
      const searchUrl = portalUrl || municipalityConfig.portalUrl;

      browser = await puppeteer.launch(config.scraper.puppeteer);
      const page = await browser.newPage();
      await page.setUserAgent(utils.getRandomUserAgent());
      page.setDefaultTimeout(config.scraper.pageTimeoutMs);

      utils.log(`[Charleston County] Navigating to: ${searchUrl}`);
      await utils.withRetry(async () => {
        await page.goto(searchUrl, {
          waitUntil: 'networkidle2',
          timeout: config.scraper.pageTimeoutMs,
        });
      }, { label: 'Charleston County portal load' });

      await utils.delay(2000);

      // Look for links to an external permit portal (many counties link to Accela, EnerGov, etc.)
      const externalLinks = await page.$$eval('a[href]', anchors => {
        return anchors
          .filter(a => {
            const href = a.href.toLowerCase();
            const text = a.textContent.toLowerCase();
            return (
              href.includes('citizenaccess') ||
              href.includes('energov') ||
              href.includes('viewpoint') ||
              href.includes('accela') ||
              href.includes('permitsonline') ||
              href.includes('citizenserve') ||
              text.includes('permit search') ||
              text.includes('online permit') ||
              text.includes('search permits') ||
              text.includes('self-service')
            );
          })
          .map(a => ({ href: a.href, text: a.textContent.trim() }));
      });

      if (externalLinks.length > 0) {
        utils.log(`[Charleston County] Found external portal links: ${JSON.stringify(externalLinks.map(l => l.text))}`);

        // Follow the first external portal link
        const portalLink = externalLinks[0];
        utils.log(`[Charleston County] Following portal link: ${portalLink.href}`);
        await page.goto(portalLink.href, {
          waitUntil: 'networkidle2',
          timeout: config.scraper.pageTimeoutMs,
        });
        await utils.delay(3000);
      }

      // Now try to interact with whatever portal we've landed on
      const currentUrl = page.url();
      utils.log(`[Charleston County] Current URL: ${currentUrl}`);

      // Try to find and fill a search form
      // Look for date inputs
      const allInputs = await page.$$eval('input', inputs =>
        inputs.map(i => ({
          id: i.id,
          name: i.name,
          type: i.type,
          placeholder: i.placeholder,
          value: i.value,
        }))
      );

      utils.log(`[Charleston County] Found ${allInputs.length} input fields on page`);

      // Try date field population
      const dateInputs = allInputs.filter(i =>
        (i.id + i.name + i.placeholder).toLowerCase().match(/date|from|start|begin/)
      );

      for (const input of dateInputs) {
        const selector = input.id ? `#${input.id}` : `input[name="${input.name}"]`;
        try {
          const el = await page.$(selector);
          if (el) {
            await el.click({ clickCount: 3 });
            await el.type(dateRange.from.replace(/-/g, '/'));
            utils.log(`[Charleston County] Set date field: ${selector}`);
          }
        } catch (e) { /* continue */ }
      }

      // Try to find a search/submit button
      const buttons = await page.$$eval(
        'button, input[type="submit"], input[type="button"], a.btn',
        btns => btns.map(b => ({
          text: b.textContent || b.value || '',
          tag: b.tagName,
          id: b.id,
          type: b.type,
        }))
      );

      const searchBtn = buttons.find(b =>
        b.text.toLowerCase().match(/search|submit|find|go/)
      );

      if (searchBtn) {
        const selector = searchBtn.id
          ? `#${searchBtn.id}`
          : `${searchBtn.tag.toLowerCase()}:has-text("${searchBtn.text.trim().substring(0, 20)}")`;
        try {
          const btn = await page.$(searchBtn.id ? `#${searchBtn.id}` : null);
          if (btn) {
            await btn.click();
            await utils.delay(5000);
          }
        } catch (e) { /* continue */ }
      }

      // Parse any results we can find
      const bodyText = await page.evaluate(() => document.body.innerText);

      // Look for tabular data
      const tables = await page.$$('table');
      if (tables.length > 0) {
        for (const table of tables) {
          const rows = await table.$$eval('tr', trs =>
            trs.map(tr => {
              const cells = Array.from(tr.querySelectorAll('td, th'));
              return cells.map(c => c.textContent.trim());
            })
          );

          if (rows.length > 1) {
            utils.log(`[Charleston County] Found table with ${rows.length} rows`);
            const headers = rows[0].map(h => h.toLowerCase());

            for (let i = 1; i < rows.length; i++) {
              const row = rows[i];
              const record = {};
              headers.forEach((h, idx) => {
                record[h] = row[idx] || null;
              });

              // Try to extract permit data from whatever columns exist
              const permitNumber = record['permit #'] || record['permit'] || record['record'] ||
                record['case'] || record['number'] || record['permit number'] || row[0];
              const address = record['address'] || record['location'] || record['site address'] ||
                record['property address'] || row[1] || row[2];
              const valueStr = record['value'] || record['valuation'] || record['job value'] ||
                record['construction value'] || record['est. value'];
              const value = utils.parseDollarValue(valueStr);

              if (value !== null && value < minValue) continue;

              // Detect sub-municipality from address
              const subMunicipality = utils.detectMunicipalityFromAddress(address);

              const permit = utils.createPermitRecord({
                permit_number: permitNumber,
                address: address,
                municipality: subMunicipality || municipalityConfig.name,
                project_value: value,
                permit_type: record['type'] || record['permit type'] || record['work type'],
                inspection_status: record['status'] || record['inspection status'],
                inspection_date: record['date'] || record['inspection date'],
                source_url: currentUrl,
              });

              if (permit.permit_number) {
                permits.push(permit);
              }
            }
          }
        }
      }

      if (permits.length === 0) {
        utils.log('[Charleston County] ⚠️  No permits parsed — saving screenshot for review');
        await utils.saveScreenshot(page, 'charleston-county-results');
      }

    } catch (error) {
      utils.log(`❌ [Charleston County] Scraper error: ${error.message}`);
      if (browser) {
        try {
          const pages = await browser.pages();
          if (pages.length > 0) await utils.saveScreenshot(pages[0], 'charleston-county-error');
        } catch (e) { /* ignore */ }
      }
      throw error;
    } finally {
      if (browser) await browser.close();
    }

    utils.log(`🏛️  [Charleston County] Scrape complete — ${permits.length} permits found`);
    return permits;
  },

  // Try to discover the actual permit search portal URL from the county website
  async discoverPortalUrl() {
    try {
      const response = await axios.get(municipalityConfig.portalUrl, {
        headers: { 'User-Agent': utils.getRandomUserAgent() },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const links = [];

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().toLowerCase();
        if (
          href.includes('citizenaccess') ||
          href.includes('energov') ||
          href.includes('viewpoint') ||
          href.includes('permitsonline') ||
          text.includes('permit search') ||
          text.includes('online permits')
        ) {
          links.push(href);
        }
      });

      if (links.length > 0) {
        utils.log(`[Charleston County] Discovered portal URL: ${links[0]}`);
        return links[0];
      }
    } catch (err) {
      utils.log(`[Charleston County] Could not discover portal URL: ${err.message}`);
    }
    return null;
  },
};
