// Builder Website Lookup — searches for builder company websites and scrapes contact info
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const PHONE_RE = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Directories/aggregators to skip when picking company website
const SKIP_DOMAINS = [
  'yelp.com', 'bbb.org', 'facebook.com', 'instagram.com', 'twitter.com',
  'linkedin.com', 'yellowpages.com', 'angi.com', 'angieslist.com',
  'homeadvisor.com', 'thumbtack.com', 'houzz.com', 'buildzoom.com',
  'manta.com', 'mapquest.com', 'google.com', 'bing.com', 'youtube.com',
  'pinterest.com', 'nextdoor.com', 'porch.com', 'chamberofcommerce.com',
  'dnb.com', 'buzzfile.com', 'bloomberg.com', 'zoominfo.com',
  'tiktok.com', 'reddit.com', 'wikipedia.org', 'amazon.com',
  'duckduckgo.com', 'apple.com', 'x.com', 'bizapedia.com',
  'opencorporates.com', 'sec.gov', 'companieslist.co',
  'newhomesource.com', 'newhomeguide.com', 'zillow.com',
  'realtor.com', 'redfin.com', 'trulia.com',
];

/**
 * Search DuckDuckGo via Puppeteer for a builder company website.
 * Uses a real browser to avoid bot detection.
 */
async function findCompanyWebsite(companyName) {
  if (!companyName) return null;

  const query = `${companyName} South Carolina`;
  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });

    // Wait for results to render
    await new Promise(r => setTimeout(r, 3000));

    // Extract all result links
    const links = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('article a[href^="http"], a[data-testid="result-title-a"]').forEach(a => {
        results.push(a.href);
      });
      // Fallback: any external links
      if (results.length === 0) {
        document.querySelectorAll('a[href^="http"]').forEach(a => {
          if (!a.href.includes('duckduckgo.com')) results.push(a.href);
        });
      }
      return [...new Set(results)];
    });

    await browser.close();
    browser = null;

    // Filter out aggregators and pick the first real company site
    for (const link of links) {
      try {
        const hostname = new URL(link).hostname.toLowerCase();
        const isSkipped = SKIP_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
        if (isSkipped) continue;
        if (hostname.includes('duckduckgo.')) continue;
        return link;
      } catch { continue; }
    }

    return null;
  } catch (err) {
    console.error(`[BuilderLookup] Search failed for "${companyName}":`, err.message);
    return null;
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// Junk email patterns to skip
const JUNK_EMAIL_PATTERNS = [
  'example.com', 'sentry.io', 'wixpress', 'wix.com', 'squarespace',
  'wordpress.com', 'w3.org', 'schema.org', 'googleapis.com', 'gstatic.com',
  'gravatar.com', 'cloudflare', '.png', '.jpg', '.svg', '.gif', '.webp',
  'noreply', 'no-reply', 'mailer-daemon', 'postmaster@', 'user@domain',
  'test@', 'admin@', 'webmaster@', 'hostmaster@', 'abuse@',
];

function isValidPhone(p) {
  const cleaned = p.replace(/[^\d]/g, '');
  if (cleaned.length !== 10 && !(cleaned.length === 11 && cleaned.startsWith('1'))) return false;
  // Skip numbers that look fake (all same digit, sequential, etc.)
  const d10 = cleaned.slice(-10);
  if (/^(\d)\1{9}$/.test(d10)) return false; // all same digit
  if (d10.startsWith('000') || d10.startsWith('111') || d10.startsWith('555')) return false;
  return true;
}

function isValidEmail(e) {
  const lower = e.toLowerCase();
  if (JUNK_EMAIL_PATTERNS.some(p => lower.includes(p))) return false;
  if (lower.length > 50) return false; // too long, likely concatenated junk
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(lower)) return false;
  // Reject emails with phone-like digit sequences in the local part
  const local = lower.split('@')[0];
  const digitsInLocal = local.replace(/[^\d]/g, '');
  if (digitsInLocal.length >= 7) return false; // 7+ digits total = probably phone number junk
  return true;
}

/**
 * Extract phones and emails from parsed HTML.
 * Priority: tel:/mailto: links > footer/header/contact sections > visible body text.
 */
function extractContactFromHtml(html, $) {
  const telPhones = new Set();   // from tel: links (highest confidence)
  const mailtoEmails = new Set(); // from mailto: links (highest confidence)
  const sectionPhones = new Set(); // from footer/header/contact text
  const sectionEmails = new Set();

  if ($) {
    // 1. tel: links — highest confidence
    $('a[href^="tel:"]').each((_, el) => {
      const tel = $(el).attr('href').replace(/^tel:\s*/, '').replace(/\s/g, '');
      if (isValidPhone(tel)) telPhones.add(tel);
    });

    // 2. mailto: links — highest confidence
    $('a[href^="mailto:"]').each((_, el) => {
      const mail = $(el).attr('href').replace(/^mailto:\s*/, '').split('?')[0].trim().toLowerCase();
      if (isValidEmail(mail)) mailtoEmails.add(mail);
    });

    // 3. Scan footer, header, contact sections for visible text
    $('script, style, noscript, svg, code, pre').remove();
    const sections = ['footer', 'header', 'nav',
      '[class*="contact"]', '[class*="footer"]', '[class*="header"]',
      '[id*="contact"]', '[id*="footer"]', '[class*="top-bar"]',
      '[class*="topbar"]', '[class*="info"]', '[class*="phone"]',
      '[class*="email"]', '[class*="widget"]', '[class*="sidebar"]'];
    for (const sel of sections) {
      try {
        $(sel).each((_, el) => {
          const text = $(el).text();
          (text.match(PHONE_RE) || []).forEach(p => { if (isValidPhone(p)) sectionPhones.add(p.trim()); });
          (text.match(EMAIL_RE) || []).forEach(e => { if (isValidEmail(e)) sectionEmails.add(e); });
        });
      } catch {}
    }

    // 4. If still missing, scan full body text (lower confidence)
    if (telPhones.size === 0 && sectionPhones.size === 0) {
      const bodyText = $('body').text();
      (bodyText.match(PHONE_RE) || []).forEach(p => { if (isValidPhone(p)) sectionPhones.add(p.trim()); });
    }
    if (mailtoEmails.size === 0 && sectionEmails.size === 0) {
      const bodyText = $('body').text();
      (bodyText.match(EMAIL_RE) || []).forEach(e => { if (isValidEmail(e)) sectionEmails.add(e); });
    }
  }

  // 5. Raw HTML fallback for tel:/mailto: (catches links cheerio might miss)
  (html.match(/href=["']tel:([^"']+)["']/gi) || []).forEach(m => {
    const tel = m.replace(/href=["']tel:\s*/i, '').replace(/["']$/, '');
    if (isValidPhone(tel)) telPhones.add(tel);
  });
  (html.match(/href=["']mailto:([^"'?]+)/gi) || []).forEach(m => {
    const mail = m.replace(/href=["']mailto:\s*/i, '').trim().toLowerCase();
    if (isValidEmail(mail)) mailtoEmails.add(mail);
  });

  // Merge: tel/mailto links first (highest confidence), then section matches
  const phones = [...telPhones, ...sectionPhones];
  const emails = [...mailtoEmails, ...sectionEmails];

  return { phones, emails };
}

/**
 * Scrape a website for contact info using Puppeteer as primary (handles JS-rendered sites).
 * Scans homepage, contact pages, about pages — checks footer, header, and body for phone/email.
 * Falls back to axios for extra pages if Puppeteer misses info.
 */
async function scrapeContactInfo(websiteUrl) {
  if (!websiteUrl) return { phones: [], emails: [] };

  const allPhones = new Set();
  const allEmails = new Set();
  const baseUrl = new URL(websiteUrl).origin;

  // All pages to try, in priority order
  const pagesToTry = [
    websiteUrl,
    `${baseUrl}/contact`,
    `${baseUrl}/contact-us`,
    `${baseUrl}/contact.html`,
    `${baseUrl}/about`,
    `${baseUrl}/about-us`,
    `${baseUrl}/about.html`,
    `${baseUrl}/get-in-touch`,
    `${baseUrl}/connect`,
    `${baseUrl}/team`,
    `${baseUrl}/our-team`,
    `${baseUrl}/locations`,
    `${baseUrl}/footer`,  // some sites have a footer page
  ];

  // ── Phase 1: Puppeteer (primary — handles ALL sites including JS-rendered) ──
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    // Try each page with Puppeteer
    for (const pageUrl of pagesToTry) {
      try {
        const resp = await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 12000 });
        if (!resp || resp.status() >= 400) continue;

        // Wait extra for JS rendering + lazy-loaded content
        await new Promise(r => setTimeout(r, 2500));

        // Scroll down to trigger lazy-loaded footers
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await new Promise(r => setTimeout(r, 1000));

        // Get fully rendered HTML
        const html = await page.content();
        const $ = cheerio.load(html);
        const { phones, emails } = extractContactFromHtml(html, $);
        phones.forEach(p => allPhones.add(p));
        emails.forEach(e => allEmails.add(e));

        console.log(`[BuilderLookup]   ${pageUrl.replace(baseUrl,'')||'/'}: ${phones.length}ph, ${emails.length}em`);

        // Also try to find contact page links from the nav/footer that we might have missed
        if (pageUrl === websiteUrl) {
          const contactLinks = await page.evaluate(() => {
            const links = [];
            document.querySelectorAll('a[href]').forEach(a => {
              const href = a.href.toLowerCase();
              const text = a.textContent.toLowerCase();
              if (text.includes('contact') || text.includes('get in touch') ||
                  text.includes('reach us') || text.includes('connect') ||
                  href.includes('/contact') || href.includes('/get-in-touch')) {
                links.push(a.href);
              }
            });
            return [...new Set(links)].slice(0, 3);
          });
          // Add discovered contact links to our list
          for (const link of contactLinks) {
            if (!pagesToTry.includes(link) && link.startsWith(baseUrl)) {
              pagesToTry.push(link);
            }
          }
        }
      } catch { continue; }
    }

    await browser.close();
    browser = null;
  } catch (err) {
    console.error(`[BuilderLookup] Puppeteer scrape failed:`, err.message);
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }

  // ── Phase 2: Axios fallback for any pages Puppeteer missed ──
  if (allPhones.size === 0 || allEmails.size === 0) {
    console.log(`[BuilderLookup] Puppeteer found ${allPhones.size} phone(s), ${allEmails.size} email(s) — trying axios fallback...`);
    for (const pageUrl of pagesToTry.slice(0, 6)) { // only try first 6 with axios
      try {
        const { data } = await axios.get(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
          timeout: 10000,
          maxRedirects: 5,
          validateStatus: s => s < 400,
        });
        const $ = cheerio.load(data);
        const { phones, emails } = extractContactFromHtml(data, $);
        phones.forEach(p => allPhones.add(p));
        emails.forEach(e => allEmails.add(e));
      } catch { continue; }
    }
  }

  return {
    phones: [...allPhones],
    emails: [...allEmails],
  };
}

/**
 * Full builder lookup: search for company website, then scrape contact info.
 */
async function lookupBuilder(companyName) {
  console.log(`[BuilderLookup] Looking up "${companyName}"...`);

  const website = await findCompanyWebsite(companyName);
  if (!website) {
    console.log(`[BuilderLookup] No website found for "${companyName}"`);
    return { website: null, phone: null, email: null };
  }

  console.log(`[BuilderLookup] Found website: ${website}`);
  const { phones, emails } = await scrapeContactInfo(website);
  console.log(`[BuilderLookup] Found ${phones.length} phone(s), ${emails.length} email(s)`);

  return {
    website,
    phone: phones[0] || null,
    email: emails[0] || null,
    allPhones: phones,
    allEmails: emails,
  };
}

/**
 * Bulk lookup: find websites and scrape contact info for all permits missing it.
 * Deduplicates by company name so the same builder is only searched once.
 */
async function bulkLookupBuilders(db, statusCallback) {
  const permits = await db.getPermitsNeedingLookup();
  if (permits.length === 0) {
    console.log('[BuilderLookup] No permits need lookup');
    if (statusCallback) statusCallback({ status: 'completed', total: 0, processed: 0 });
    return { total: 0, found: 0, errors: 0 };
  }

  // Deduplicate by company name — look up each company only once
  const companyMap = new Map(); // companyName -> [permitIds]
  for (const p of permits) {
    const company = (p.builder_company || '').trim();
    if (!company) continue;
    if (!companyMap.has(company)) companyMap.set(company, []);
    companyMap.get(company).push(p);
  }

  const uniqueCompanies = [...companyMap.keys()];
  console.log(`[BuilderLookup] Bulk lookup: ${uniqueCompanies.length} unique companies across ${permits.length} permits`);

  let processed = 0;
  let found = 0;
  let errors = 0;

  for (const company of uniqueCompanies) {
    processed++;
    if (statusCallback) {
      statusCallback({ status: 'running', total: uniqueCompanies.length, processed, current: company });
    }

    try {
      const result = await lookupBuilder(company);
      const companyPermits = companyMap.get(company);

      for (const permit of companyPermits) {
        const updates = {};
        if (result.phone && !permit.builder_phone) updates.phone = result.phone;
        if (result.email && !permit.builder_email) updates.email = result.email;
        if (result.website) updates.website = result.website;

        if (Object.keys(updates).length > 0) {
          await db.updateBuilderContact(permit.id, updates);
        }
      }

      if (result.website) found++;
    } catch (err) {
      console.error(`[BuilderLookup] Error looking up "${company}":`, err.message);
      errors++;
    }

    // Rate limit between lookups to avoid getting blocked
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[BuilderLookup] Bulk lookup complete: ${found}/${uniqueCompanies.length} companies found, ${errors} errors`);
  if (statusCallback) statusCallback({ status: 'completed', total: uniqueCompanies.length, processed, found, errors });

  return { total: uniqueCompanies.length, found, errors };
}

/**
 * Placeholder for future skip-trace API integration.
 * Will accept a person name and company, return personal contact info.
 */
async function skipTraceLookup(name, company) {
  // TODO: Integrate skip-trace API here when API key is provided
  return null;
}

module.exports = { lookupBuilder, bulkLookupBuilders, findCompanyWebsite, scrapeContactInfo, skipTraceLookup };
