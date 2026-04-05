// SC LLR Bulk Targeted Scraper
// Looks up only builders we have in permits/cache — avoids reCAPTCHA by staying targeted
// Uses llr-lookup.js (Puppeteer + ASP.NET ViewState) for each lookup
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const llrLookup = require('./llr-lookup');
const builderCache = require('./builder-cache');
const utils = require('./utils');

const LLR_DATA_PATH = path.join(__dirname, '..', 'data', 'llr-contractors.json');

// ─── State ───────────────────────────────────────────────────────────────────
let scrapeState = {
  status: 'idle',
  total: 0,
  checked: 0,
  found: 0,
  skipped: 0,
  current: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

function getStatus() {
  return { ...scrapeState };
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function loadLlrData() {
  try {
    if (fs.existsSync(LLR_DATA_PATH)) {
      return JSON.parse(fs.readFileSync(LLR_DATA_PATH, 'utf-8'));
    }
  } catch (err) {
    utils.log(`[LLRScraper] Failed to load llr-contractors.json: ${err.message}`);
  }
  return {};
}

function saveLlrData(data) {
  try {
    const dir = path.dirname(LLR_DATA_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LLR_DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    utils.log(`[LLRScraper] Failed to save llr-contractors.json: ${err.message}`);
  }
}

// ─── Normalize key (matches builder-cache.js normalization) ──────────────────
function normalizeKey(name) {
  if (!name) return null;
  return name.toLowerCase().trim()
    .replace(/,?\s*(llc|inc\.?|corp\.?|co\.?|l\.?l\.?c\.?|incorporated|corporation|company|group|enterprises?)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,]+$/, '')
    .trim();
}

// ─── Collect unique builder names ─────────────────────────────────────────────
async function collectBuilderNames(db) {
  const names = new Set();

  // 1. From permits DB
  try {
    const permits = await db.queryPermits({ limit: 9999 });
    for (const p of permits) {
      if (p.builder_company) names.add(p.builder_company.trim());
      else if (p.builder_name) names.add(p.builder_name.trim());
    }
    utils.log(`[LLRScraper] ${names.size} builder names from permits DB`);
  } catch (err) {
    utils.log(`[LLRScraper] Error reading permits: ${err.message}`);
  }

  // 2. Also pull from builder-cache (keys are already normalized company names)
  try {
    const cache = builderCache.loadCache();
    for (const key of Object.keys(cache)) {
      names.add(key);
    }
    utils.log(`[LLRScraper] ${names.size} total builder names after merging cache`);
  } catch (err) {
    utils.log(`[LLRScraper] Error reading builder cache: ${err.message}`);
  }

  // Filter out obviously short/empty names
  return [...names].filter(n => n && n.length >= 3);
}

// ─── Main bulk scrape ─────────────────────────────────────────────────────────
async function runScrape(db) {
  if (scrapeState.status === 'running') {
    utils.log('[LLRScraper] Already running — skipping');
    return;
  }

  scrapeState = {
    status: 'running',
    total: 0,
    checked: 0,
    found: 0,
    skipped: 0,
    current: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  let browser = null;
  try {
    const builderNames = await collectBuilderNames(db);
    const llrData = loadLlrData();

    scrapeState.total = builderNames.length;
    utils.log(`[LLRScraper] Starting targeted scrape of ${builderNames.length} builders`);

    // Launch Puppeteer (single browser, shared page)
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    // Verify LLR site is reachable before burning through the list
    const available = await llrLookup.isAvailable(page);
    if (!available) {
      utils.log('[LLRScraper] SC LLR site is unreachable — aborting');
      scrapeState.status = 'error';
      scrapeState.error = 'SC LLR site unreachable';
      scrapeState.finishedAt = new Date().toISOString();
      return;
    }

    for (const company of builderNames) {
      const key = normalizeKey(company);
      if (!key) {
        scrapeState.checked++;
        continue;
      }

      // Skip if already in our LLR cache
      if (llrData[key]) {
        scrapeState.checked++;
        scrapeState.skipped++;
        continue;
      }

      scrapeState.current = company;
      scrapeState.checked++;

      try {
        const result = await llrLookup.lookupContractor(company, page);
        if (result) {
          llrData[key] = {
            licenseName: result.licenseName || null,
            licenseNumber: result.licenseNumber || null,
            phone: result.phone || null,
            email: result.email || null,
            address: result.address || null,
            classification: result.classification || null,
            status: result.status || null,
            allPhones: result.allPhones || [],
            allEmails: result.allEmails || [],
            source: result.source || 'sc-llr',
            lookedUpAt: new Date().toISOString(),
          };
          scrapeState.found++;
          utils.log(`[LLRScraper] Found: "${company}" => ${result.phone || 'no phone'}, ${result.email || 'no email'}`);
          // Save after every hit so progress is preserved if we crash
          saveLlrData(llrData);
        } else {
          // Record a null entry so we skip it next time
          llrData[key] = { lookedUpAt: new Date().toISOString(), noRecord: true };
          saveLlrData(llrData);
        }
      } catch (err) {
        utils.log(`[LLRScraper] Error looking up "${company}": ${err.message}`);
      }

      // Rate limit: 3-5 second delay between requests
      const delay = 3000 + Math.floor(Math.random() * 2000);
      await new Promise(r => setTimeout(r, delay));
    }

    scrapeState.status = 'idle';
    scrapeState.finishedAt = new Date().toISOString();
    scrapeState.current = null;
    utils.log(`[LLRScraper] Done. ${scrapeState.found} found, ${scrapeState.skipped} skipped of ${scrapeState.total} builders`);
  } catch (err) {
    utils.log(`[LLRScraper] Fatal error: ${err.message}`);
    scrapeState.status = 'error';
    scrapeState.error = err.message;
    scrapeState.finishedAt = new Date().toISOString();
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

// ─── Module exports ───────────────────────────────────────────────────────────
module.exports = { runScrape, getStatus, loadLlrData, LLR_DATA_PATH };

// ─── Quick test (run directly: node scraper/llr-scraper.js) ──────────────────
if (require.main === module) {
  (async () => {
    utils.log('[LLRScraper] Running test lookup for 2 known builders');

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );

      const testBuilders = ['Blessed 2 LLC', 'Rhodes Construction'];

      for (const name of testBuilders) {
        utils.log(`\n[LLRScraper] Looking up: "${name}"`);
        const result = await llrLookup.lookupContractor(name, page);
        if (result) {
          utils.log(`  licenseName:   ${result.licenseName || '—'}`);
          utils.log(`  licenseNumber: ${result.licenseNumber || '—'}`);
          utils.log(`  phone:         ${result.phone || '—'}`);
          utils.log(`  email:         ${result.email || '—'}`);
          utils.log(`  address:       ${result.address || '—'}`);
        } else {
          utils.log(`  No records found`);
        }
        // Delay between test lookups
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      utils.log(`[LLRScraper] Test error: ${err.message}`);
    } finally {
      if (browser) {
        try { await browser.close(); } catch {}
      }
    }

    process.exit(0);
  })();
}
