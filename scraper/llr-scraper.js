// SC LLR Contractor Scraper
// Two modes:
//   1. Targeted (runScrape): looks up only builders from our permits/cache
//   2. Comprehensive (scrapeAll): crawls ALL contractors A-Z via search
//
// The site (verify.llronline.com) uses ASP.NET WebForms with invisible reCAPTCHA v2.
// Invisible reCAPTCHA auto-passes on clean IP sessions with stealth Puppeteer settings.
// After repeated requests from the same IP, Google may show an image challenge.
// Use LLR_DELAY_MS env var to control rate limiting (default: 2000ms).
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const llrLookup = require('./llr-lookup');
const builderCache = require('./builder-cache');
const utils = require('./utils');

const LLR_DATA_PATH = path.join(__dirname, '..', 'data', 'llr-contractors.json');
const LLR_PROGRESS_PATH = path.join(__dirname, '..', 'data', 'llr-scrape-progress.json');
const BASE_URL = 'https://verify.llronline.com/LicLookup/Contractors';
const SEARCH_URL = `${BASE_URL}/Contractor.aspx?div=69`;
const DELAY_MS = parseInt(process.env.LLR_DELAY_MS || '2000', 10);

// Search terms for comprehensive A-Z scrape
const ALL_SEARCH_TERMS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];

const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

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

// Comprehensive scrape state (separate from targeted state)
let comprehensiveState = {
  running: false,
  status: 'idle',
  currentSearch: null,
  totalFound: 0,
  totalWithContact: 0,
  startedAt: null,
  completedAt: null,
  error: null,
  completedTerms: [],
};

function getStatus() {
  return { ...scrapeState };
}

function getComprehensiveStatus() {
  return { ...comprehensiveState };
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

function loadProgress() {
  try {
    if (fs.existsSync(LLR_PROGRESS_PATH)) {
      return JSON.parse(fs.readFileSync(LLR_PROGRESS_PATH, 'utf-8'));
    }
  } catch (err) {}
  return { completedTerms: [] };
}

function saveProgress(progress) {
  try {
    const dir = path.dirname(LLR_PROGRESS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LLR_PROGRESS_PATH, JSON.stringify(progress, null, 2));
  } catch (err) {
    utils.log(`[LLRScraper] Failed to save progress: ${err.message}`);
  }
}

// ─── Puppeteer stealth helpers ────────────────────────────────────────────────

// Launch options that minimize bot-detection signals for reCAPTCHA
function getStealthLaunchOptions() {
  return {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
      '--disable-dev-shm-usage',
    ],
    defaultViewport: { width: 1920, height: 1080 },
  };
}

// Create a page with navigator.webdriver spoofed to avoid reCAPTCHA detection
async function createStealthPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    window.Notification = { permission: 'denied' };
    // Permissions API spoofing
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);
  });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  return page;
}

// ─── Comprehensive search helpers ────────────────────────────────────────────

// Wait for search results to appear after clicking the reCAPTCHA/submit button.
// Returns true if results found, false if captcha failed or timed out.
async function waitForSearchResults(page, timeoutMs = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1000));
    const state = await page.evaluate(() => {
      const resultEl = document.querySelector('#ctl00_ContentPlaceHolder2_lbl_results');
      const captchaErr = document.querySelector('#ctl00_ContentPlaceHolder1_UserInputGen_CaptchaIncorrectLabel');
      return {
        results: resultEl ? resultEl.textContent.trim() : '',
        captchaFailed: captchaErr ? captchaErr.textContent.trim() !== '' : false,
      };
    }).catch(() => ({ results: '', captchaFailed: false }));

    if (state.results) return true;
    if (state.captchaFailed) {
      utils.log('[LLR] reCAPTCHA rejected by server');
      return false;
    }
  }
  return false;
}

// Parse the search results table from page HTML
function parseResultsTable(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $('#ctl00_ContentPlaceHolder2_gv_results tr').each((i, row) => {
    if (i === 0) return; // skip header row

    const cells = $(row).find('td').map((_, td) => {
      const text = $(td).text().trim();
      return text === '\u00a0' ? '' : text;
    }).get();
    if (cells.length < 8) return;

    const link = $(row).find('a').attr('href') || '';
    const urlMatch = link.match(/window\.open\('([^']+)'/);

    rows.push({
      license_number: cells[0] || '',
      license_status: cells[1] || '',
      license_type: cells[2] || '',
      person_last: cells[3] || '',
      person_first: cells[4] || '',
      person_suffix: cells[5] || '',
      business_name: cells[6] || '',
      city: cells[7] || '',
      state: cells[8] || '',
      detail_path: urlMatch ? urlMatch[1] : null,
    });
  });

  return rows;
}

// Find pagination "next page" __doPostBack link if present
function findNextPagePostback(html) {
  const $ = cheerio.load(html);
  let nextPostback = null;

  // Pagination row is the last tr in gv_results, contains page number links
  $('#ctl00_ContentPlaceHolder2_gv_results tr:last-child a').each((_, a) => {
    const text = $(a).text().trim();
    const href = $(a).attr('href') || '';
    if ((text === '>' || text === 'Next') && href.includes('__doPostBack')) {
      const m = href.match(/__doPostBack\('([^']+)',\s*'([^']+)'\)/);
      if (m) nextPostback = { target: m[1], arg: m[2] };
    }
  });

  return nextPostback;
}

// Parse a Contractor2.aspx detail page for contact information
function parseDetailPage(html, url) {
  if (url && url.includes('ExpiredSearch')) return null;

  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  const phones = [...new Set((bodyText.match(PHONE_RE) || []))];
  const emails = [...new Set((bodyText.match(EMAIL_RE) || []))].filter(
    e => !e.includes('llr.sc.gov') && !e.includes('sc.gov') && !e.includes('llronline.com')
  );

  // Extract address from table cells
  let address = null;
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 2) {
      const label = $(cells[0]).text().trim().toLowerCase();
      const value = $(cells[1]).text().trim();
      if ((label.includes('address') || label.includes('street')) && value) {
        address = value;
      }
    }
  });

  return {
    phone: phones[0] || null,
    email: emails[0] || null,
    all_phones: phones,
    all_emails: emails,
    address,
  };
}

// Perform one search term (e.g., "A") and collect all result rows across pages
async function searchByTerm(page, searchTerm) {
  utils.log(`[LLR] Searching for: "${searchTerm}"`);

  await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  // Simulate human mouse movement
  await page.mouse.move(300 + Math.random() * 100, 200 + Math.random() * 80, { steps: 8 });
  await new Promise(r => setTimeout(r, 300 + Math.random() * 300));

  // Type in company/last name field
  await page.click('#ctl00_ContentPlaceHolder1_UserInputGen_txt_lastName');
  await new Promise(r => setTimeout(r, 150 + Math.random() * 150));
  for (const char of searchTerm) {
    await page.keyboard.press(char);
    await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
  }
  await new Promise(r => setTimeout(r, 600 + Math.random() * 400));

  // Click the reCAPTCHA/submit button with human-like mouse movement
  const gBtn = await page.$('.g-recaptcha');
  if (!gBtn) throw new Error('reCAPTCHA button not found — page structure may have changed');
  const box = await gBtn.boundingBox();
  await page.mouse.move(
    box.x + box.width / 2 + (Math.random() - 0.5) * 8,
    box.y + box.height / 2 + (Math.random() - 0.5) * 4,
    { steps: 12 + Math.floor(Math.random() * 8) }
  );
  await new Promise(r => setTimeout(r, 200 + Math.random() * 200));
  await gBtn.click();

  const gotResults = await waitForSearchResults(page, 40000);
  if (!gotResults) {
    utils.log(`[LLR] No results for "${searchTerm}" — reCAPTCHA may have failed`);
    return [];
  }

  const resultsText = await page.$eval(
    '#ctl00_ContentPlaceHolder2_lbl_results',
    el => el.textContent.trim()
  ).catch(() => '');

  utils.log(`[LLR] "${searchTerm}": ${resultsText}`);

  if (!resultsText || resultsText.includes('0 record')) return [];

  // Collect all pages of results
  const allRows = [];
  let pageNum = 1;

  while (true) {
    const html = await page.content();
    const rows = parseResultsTable(html);
    allRows.push(...rows);
    utils.log(`[LLR] "${searchTerm}" page ${pageNum}: ${rows.length} rows (total: ${allRows.length})`);

    // Check for next page
    const nextPostback = findNextPagePostback(html);
    if (!nextPostback) break;

    pageNum++;
    await page.evaluate((target, arg) => {
      // ASP.NET postback for grid pagination
      window.__doPostBack(target, arg);
    }, nextPostback.target, nextPostback.arg);
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  }

  return allRows;
}

// Fetch the Contractor2.aspx detail page within the same browser session
async function fetchDetailPage(page, detailPath) {
  if (!detailPath) return null;
  const detailUrl = `${BASE_URL}/${detailPath}`;
  try {
    await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 500));
    const currentUrl = page.url();
    const html = await page.content();
    return parseDetailPage(html, currentUrl);
  } catch (err) {
    utils.log(`[LLR] Detail page error for "${detailPath}": ${err.message}`);
    return null;
  }
}

// ─── Comprehensive scrape ─────────────────────────────────────────────────────

// Scrape ALL contractors by searching A-Z (or custom search terms).
// Saves results to data/llr-contractors.json and updates builder cache.
// Resumable: tracks completed search terms in data/llr-scrape-progress.json.
async function scrapeAll(options = {}) {
  const {
    searchTerms = process.env.LLR_SEARCH_TERMS
      ? process.env.LLR_SEARCH_TERMS.split(',').map(s => s.trim())
      : ALL_SEARCH_TERMS,
    skipDetails = false,
    force = false,
    onProgress = null,
  } = options;

  if (comprehensiveState.running) throw new Error('Comprehensive scrape already in progress');

  comprehensiveState = {
    running: true,
    status: 'starting',
    currentSearch: null,
    totalFound: 0,
    totalWithContact: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    completedTerms: [],
  };

  const contractors = loadLlrData();
  const progress = force ? { completedTerms: [] } : loadProgress();
  const completedTerms = new Set(progress.completedTerms || []);

  utils.log(`[LLR] Comprehensive scrape starting. ${completedTerms.size}/${searchTerms.length} terms already done.`);

  let browser;
  try {
    browser = await puppeteer.launch(getStealthLaunchOptions());
    let page = await createStealthPage(browser);

    for (const term of searchTerms) {
      if (completedTerms.has(term) && !force) {
        utils.log(`[LLR] Skipping "${term}" (already completed)`);
        comprehensiveState.completedTerms.push(term);
        continue;
      }

      comprehensiveState.currentSearch = term;
      comprehensiveState.status = `searching:${term}`;
      if (onProgress) onProgress(getComprehensiveStatus());

      let rows = [];
      // Retry up to 3 times with a fresh page on each retry
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) {
          utils.log(`[LLR] Retry ${attempt}/3 for "${term}" — fresh page`);
          await page.close().catch(() => {});
          page = await createStealthPage(browser);
          await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
        }
        try {
          rows = await searchByTerm(page, term);
          break; // success
        } catch (err) {
          utils.log(`[LLR] Search attempt ${attempt} failed for "${term}": ${err.message}`);
          if (attempt === 3) utils.log(`[LLR] Giving up on "${term}"`);
        }
      }

      utils.log(`[LLR] "${term}": ${rows.length} contractors found`);

      // Process each row
      for (const row of rows) {
        if (!row.license_number) continue;

        const key = row.license_number;
        const existing = contractors[key] || {};

        const contractor = {
          ...existing,
          license_number: row.license_number,
          license_status: row.license_status,
          license_type: row.license_type,
          person_name: [row.person_first, row.person_last, row.person_suffix]
            .filter(Boolean).join(' ').trim() || existing.person_name || null,
          business_name: row.business_name || existing.business_name || null,
          city: row.city || existing.city || null,
          state: row.state || existing.state || null,
          phone: existing.phone || null,
          email: existing.email || null,
          all_phones: existing.all_phones || [],
          all_emails: existing.all_emails || [],
          address: existing.address || null,
          scraped_at: existing.scraped_at || new Date().toISOString(),
          detail_fetched: existing.detail_fetched || false,
        };

        // Fetch detail page if not already done
        if (!contractor.detail_fetched && row.detail_path && !skipDetails) {
          await new Promise(r => setTimeout(r, DELAY_MS));
          const detail = await fetchDetailPage(page, row.detail_path);
          if (detail) {
            contractor.phone = detail.phone || contractor.phone;
            contractor.email = detail.email || contractor.email;
            contractor.all_phones = detail.all_phones.length ? detail.all_phones : contractor.all_phones;
            contractor.all_emails = detail.all_emails.length ? detail.all_emails : contractor.all_emails;
            contractor.address = detail.address || contractor.address;
            contractor.detail_fetched = true;
            contractor.detail_fetched_at = new Date().toISOString();
          }
        }

        contractors[key] = contractor;
        comprehensiveState.totalFound++;
        if (contractor.phone || contractor.email) comprehensiveState.totalWithContact++;
      }

      // Mark term done and save checkpoint
      completedTerms.add(term);
      comprehensiveState.completedTerms.push(term);
      saveLlrData(contractors);
      saveProgress({ completedTerms: [...completedTerms], lastUpdated: new Date().toISOString() });
      if (onProgress) onProgress(getComprehensiveStatus());

      await new Promise(r => setTimeout(r, DELAY_MS + Math.random() * 1000));
    }

    // Enrich builder cache with LLR data
    enrichBuilderCache(contractors);

    comprehensiveState.status = 'completed';
    comprehensiveState.completedAt = new Date().toISOString();
    comprehensiveState.running = false;
    utils.log(`[LLR] Comprehensive scrape done. ${comprehensiveState.totalFound} found, ${comprehensiveState.totalWithContact} with contact.`);
    return getComprehensiveStatus();
  } catch (err) {
    comprehensiveState.status = 'error';
    comprehensiveState.error = err.message;
    comprehensiveState.running = false;
    comprehensiveState.completedAt = new Date().toISOString();
    utils.log(`[LLR] Comprehensive scrape error: ${err.message}`);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Cross-reference LLR data with builder cache, enriching with phone/email/license info
function enrichBuilderCache(contractors) {
  utils.log('[LLR] Enriching builder cache with LLR data...');
  const list = Object.values(contractors);
  let enriched = 0;

  // Build lookup by normalized business name
  const byName = new Map();
  for (const c of list) {
    if (!c.business_name) continue;
    const key = builderCache.normalizeKey(c.business_name);
    if (key) {
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(c);
    }
  }

  const cache = builderCache.loadCache();
  for (const cacheKey of Object.keys(cache)) {
    if (cacheKey.startsWith('__')) continue;

    let matches = byName.get(cacheKey) || [];
    // Fuzzy: check prefix overlap
    if (!matches.length) {
      for (const [name, cs] of byName.entries()) {
        if (name.length > 3 && (name.startsWith(cacheKey) || cacheKey.startsWith(name))) {
          matches = cs;
          break;
        }
      }
    }
    if (!matches.length) continue;

    const best = matches.find(c => c.license_status === 'Active' && (c.phone || c.email))
      || matches.find(c => c.phone || c.email)
      || matches.find(c => c.license_status === 'Active')
      || matches[0];

    const entry = cache[cacheKey];
    let updated = false;

    if (best.phone && !entry.phone) {
      entry.phone = best.phone;
      entry.allPhones = [...new Set([...(entry.allPhones || []), best.phone])];
      updated = true;
    }
    if (best.email && !entry.email) {
      entry.email = best.email;
      entry.allEmails = [...new Set([...(entry.allEmails || []), best.email])];
      updated = true;
    }
    if (!entry.llr_license_number && best.license_number) {
      entry.llr_license_number = best.license_number;
      entry.llr_license_status = best.license_status;
      entry.llr_license_type = best.license_type;
      updated = true;
    }
    if (updated) {
      entry.llr_enriched_at = new Date().toISOString();
      enriched++;
    }
  }

  if (enriched > 0) {
    builderCache.saveCache();
    utils.log(`[LLR] Enriched ${enriched} builder cache entries with LLR data`);
  } else {
    utils.log('[LLR] No builder cache entries enriched');
  }
}

function getContractorStats() {
  const data = loadLlrData();
  const list = Object.values(data);
  return {
    total: list.length,
    active: list.filter(c => c.license_status === 'Active').length,
    withPhone: list.filter(c => c.phone).length,
    withEmail: list.filter(c => c.email).length,
  };
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
module.exports = {
  // Targeted mode (existing): looks up builders from permits/cache
  runScrape,
  getStatus,
  // Comprehensive mode (new): scrapes ALL contractors A-Z
  scrapeAll,
  getComprehensiveStatus,
  // Shared utilities
  loadLlrData,
  getContractorStats,
  enrichBuilderCache,
  LLR_DATA_PATH,
};

// ─── CLI entry point ──────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const skipDetails = args.includes('--skip-details');
  const mode = args.find(a => !a.startsWith('--')) || 'comprehensive';

  if (mode === 'comprehensive' || mode === 'all') {
    utils.log('[LLRScraper] Running comprehensive A-Z scrape...');
    scrapeAll({ force, skipDetails })
      .then(status => {
        utils.log('[LLRScraper] Done: ' + JSON.stringify(status));
        process.exit(0);
      })
      .catch(err => { utils.log('[LLRScraper] Error: ' + err.message); process.exit(1); });
  } else if (mode === 'enrich') {
    utils.log('[LLRScraper] Running builder cache enrichment only...');
    enrichBuilderCache(loadLlrData());
    process.exit(0);
  } else {
    // Default: quick test lookup for a few known builders
    utils.log('[LLRScraper] Running test lookup for known builders');
    (async () => {
      let browser;
      try {
        browser = await puppeteer.launch(getStealthLaunchOptions());
        const page = await createStealthPage(browser);
        const testBuilders = ['Blessed 2 LLC', 'Rhodes Construction'];
        for (const name of testBuilders) {
          utils.log(`Looking up: "${name}"`);
          const result = await llrLookup.lookupContractor(name, page);
          utils.log(result
            ? `  => phone: ${result.phone || 'none'}, email: ${result.email || 'none'}`
            : '  => No records found');
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (err) {
        utils.log('[LLRScraper] Test error: ' + err.message);
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
      process.exit(0);
    })();
  }
}
