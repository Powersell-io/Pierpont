// Charleston Home Builders Association Directory Scraper
// Crawls charlestonbuildersdirectory.com and seeds the builder cache
const axios = require('axios');
const cheerio = require('cheerio');
const utils = require('./utils');
const builderCache = require('./builder-cache');
const config = require('../config');

const BASE_URL = 'http://www.charlestonbuildersdirectory.com';
const LISTINGS_URL = `${BASE_URL}/listings.php`;
const DETAIL_URL = `${BASE_URL}/listing.php`;

const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

let scanStatus = null;

function getScanStatus() {
  return scanStatus;
}

async function fetchPage(url) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': utils.getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml',
    },
    timeout: 30000,
  });
  return cheerio.load(data);
}

// Extract listing IDs and basic info from a listings page
function extractListings($) {
  const listings = [];
  const seenIds = new Set();
  $('a[href*="listing.php?listing_id="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/listing_id=(\d+)/);
    if (!match) return;
    const id = match[1];
    if (seenIds.has(id)) return;

    let name = $(el).text().trim();
    // Skip "View More..." links
    if (name === 'View More...') return;

    // Featured/spotlight entries may have empty text — extract from URL param
    if (!name || name.length <= 1) {
      const nameMatch = href.match(/company_name=([^&]+)/);
      if (nameMatch) {
        name = decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')).trim();
      }
    }

    // Clean up whitespace and trailing descriptions
    name = name.replace(/\s+/g, ' ').trim();

    if (name && name.length > 1) {
      seenIds.add(id);
      listings.push({ id, name, href: `${DETAIL_URL}?listing_id=${id}` });
    }
  });
  return listings;
}

// Check if there's a next page link
function getNextPageUrl($, currentUrl) {
  let nextUrl = null;
  $('a').each((_, el) => {
    const text = $(el).text().trim();
    if (text.toLowerCase().includes('next')) {
      const href = $(el).attr('href');
      if (href) {
        nextUrl = href.startsWith('http') ? href : `${LISTINGS_URL}${href.startsWith('?') ? '' : '?'}${href}`;
      }
    }
  });
  return nextUrl;
}

// Scrape a detail page for full contact info
async function scrapeDetailPage(listingUrl, companyName) {
  try {
    const $ = await fetchPage(listingUrl);

    const phones = new Set();
    const emails = new Set();
    let website = null;
    let contactPerson = null;
    let title = null;
    let address = null;

    // Find the contact info section (ul inside the main content area)
    // Structure: <ul> with <li> entries for person, title, address, phones, emails
    $('ul').each((_, ul) => {
      const items = $(ul).find('li');
      if (items.length < 2) return;

      items.each((idx, li) => {
        const text = $(li).text().trim();
        const html = $(li).html() || '';

        // Phone numbers (next to phone icon)
        if (html.includes('phone.png') || html.includes('images/phone')) {
          const phoneMatches = text.match(PHONE_RE);
          if (phoneMatches) phoneMatches.forEach(p => phones.add(p.trim()));
        }

        // Email (mailto links)
        const mailtoLink = $(li).find('a[href^="mailto:"]');
        if (mailtoLink.length > 0) {
          const email = mailtoLink.attr('href').replace(/^mailto:\s*/i, '').split('?')[0].trim().toLowerCase();
          if (email && email.includes('@')) emails.add(email);
        }

        // Also check for email in text
        const emailMatches = text.match(EMAIL_RE);
        if (emailMatches) emailMatches.forEach(e => emails.add(e.toLowerCase()));
      });
    });

    // Website links (look for external links that aren't social/directory)
    $('a[href^="http"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().toLowerCase();
      if (website) return; // Take first one
      try {
        const hostname = new URL(href).hostname.toLowerCase();
        if (hostname.includes('charlestonbuildersdirectory')) return;
        if (hostname.includes('facebook.com') || hostname.includes('instagram.com') ||
            hostname.includes('twitter.com') || hostname.includes('linkedin.com') ||
            hostname.includes('youtube.com') || hostname.includes('google.com')) return;
        // Check if the link text or href looks like a company website
        if (text.includes('visit') || text.includes('website') || text.includes('www') ||
            text.includes('.com') || href.includes(companyName.toLowerCase().split(' ')[0])) {
          website = href;
        }
      } catch {}
    });

    // If no website found from links, check for www/http in text
    if (!website) {
      const bodyText = $('body').text();
      const urlMatch = bodyText.match(/https?:\/\/[^\s<>"]+/);
      if (urlMatch) {
        try {
          const hostname = new URL(urlMatch[0]).hostname;
          if (!hostname.includes('charlestonbuildersdirectory')) {
            website = urlMatch[0];
          }
        } catch {}
      }
    }

    // Extract contact person — typically the first <li> in the contact section
    // that doesn't contain a phone icon, email, or address pattern
    $('ul').each((_, ul) => {
      if (contactPerson) return;
      const items = $(ul).find('li');
      items.each((idx, li) => {
        if (contactPerson) return;
        const text = $(li).text().trim();
        const html = $(li).html() || '';
        // Skip phone/email/address entries
        if (html.includes('phone.png') || html.includes('email.png')) return;
        if (text.match(PHONE_RE) || text.match(EMAIL_RE)) return;
        if (text.match(/\d{5}/) || text.includes(', SC ') || text.includes(', sc ')) return;
        if (text.length < 3 || text.length > 60) return;
        // Looks like a person name (has at least 2 words, no special chars)
        if (text.split(/\s+/).length >= 2 && /^[A-Za-z\s.'-]+$/.test(text)) {
          contactPerson = text;
        }
      });
    });

    return {
      website,
      phone: [...phones][0] || null,
      email: [...emails][0] || null,
      allPhones: [...phones],
      allEmails: [...emails],
      contactPerson,
    };
  } catch (err) {
    utils.log(`[Directory] Error scraping detail page for "${companyName}": ${err.message}`);
    return null;
  }
}

const CRAWL_INTERVAL_DAYS = 90;

/**
 * Crawl the full Charleston HBA directory and populate the builder cache.
 * Only runs a fresh crawl every 90 days — skips if recently crawled.
 * Pass force=true to bypass the throttle.
 */
async function scrapeDirectory(statusCallback, { force = false } = {}) {
  // Check if we've crawled recently
  const lastCrawled = builderCache.getDirectoryLastCrawled();
  if (lastCrawled && !force) {
    const daysSince = (Date.now() - new Date(lastCrawled).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < CRAWL_INTERVAL_DAYS) {
      utils.log(`[Directory] Last crawled ${Math.round(daysSince)} days ago (threshold: ${CRAWL_INTERVAL_DAYS}). Skipping. Use force=true to override.`);
      scanStatus = { status: 'skipped', reason: `Last crawled ${Math.round(daysSince)} days ago`, lastCrawled };
      if (statusCallback) statusCallback(scanStatus);
      return { skipped: true, daysSince: Math.round(daysSince) };
    }
  }

  utils.log('[Directory] Starting Charleston HBA directory scrape...');
  scanStatus = { status: 'crawling_listings', total: 0, processed: 0, cached: 0, errors: 0 };
  if (statusCallback) statusCallback(scanStatus);

  // Phase 1: Crawl all listing pages to collect company IDs
  const allListings = [];
  let pageUrl = LISTINGS_URL; // All members
  let pageNum = 1;
  const seenIds = new Set();

  while (pageUrl) {
    try {
      utils.log(`[Directory] Fetching listings page ${pageNum}...`);
      const $ = await fetchPage(pageUrl);
      const listings = extractListings($);

      for (const listing of listings) {
        if (!seenIds.has(listing.id)) {
          seenIds.add(listing.id);
          allListings.push(listing);
        }
      }

      utils.log(`[Directory] Page ${pageNum}: found ${listings.length} listings (${allListings.length} total unique)`);

      // Find next page
      const nextHref = getNextPageUrl($, pageUrl);
      if (nextHref && nextHref !== pageUrl) {
        const resolvedUrl = nextHref.startsWith('http') ? nextHref : `${LISTINGS_URL}${nextHref}`;
        if (resolvedUrl !== pageUrl) {
          pageUrl = resolvedUrl;
          pageNum++;
          await utils.delay(1500); // Be polite
        } else {
          pageUrl = null;
        }
      } else {
        pageUrl = null;
      }
    } catch (err) {
      utils.log(`[Directory] Error on page ${pageNum}: ${err.message}`);
      pageUrl = null;
    }
  }

  utils.log(`[Directory] Found ${allListings.length} total listings across ${pageNum} pages`);

  // Also crawl the Builders > Residential subcategory in case some aren't in all-members
  try {
    let residentialUrl = `${LISTINGS_URL}?section_id=%25&cat=Builders&scat=Builder+-+Residential`;
    let rPageNum = 1;
    while (residentialUrl) {
      const $ = await fetchPage(residentialUrl);
      const listings = extractListings($);
      for (const listing of listings) {
        if (!seenIds.has(listing.id)) {
          seenIds.add(listing.id);
          allListings.push(listing);
        }
      }
      utils.log(`[Directory] Residential page ${rPageNum}: ${listings.length} listings`);
      const nextHref = getNextPageUrl($, residentialUrl);
      if (nextHref) {
        const resolvedUrl = nextHref.startsWith('http') ? nextHref : `${LISTINGS_URL}${nextHref}`;
        if (resolvedUrl !== residentialUrl) {
          residentialUrl = resolvedUrl;
          rPageNum++;
          await utils.delay(1500);
        } else {
          residentialUrl = null;
        }
      } else {
        residentialUrl = null;
      }
    }
  } catch (err) {
    utils.log(`[Directory] Error crawling residential subcategory: ${err.message}`);
  }

  utils.log(`[Directory] Total unique listings after all categories: ${allListings.length}`);

  // Phase 2: Scrape detail pages for each listing
  scanStatus = { status: 'scraping_details', total: allListings.length, processed: 0, cached: 0, errors: 0 };
  if (statusCallback) statusCallback(scanStatus);

  let processed = 0;
  let cached = 0;
  let errors = 0;
  let skippedExcluded = 0;
  let skippedCached = 0;

  for (const listing of allListings) {
    processed++;
    scanStatus = { status: 'scraping_details', total: allListings.length, processed, cached, errors, current: listing.name };
    if (statusCallback) statusCallback(scanStatus);

    // Skip excluded builders
    const excluded = config.excludedBuilders || [];
    const isExcluded = excluded.some(pattern => listing.name.toLowerCase().includes(pattern.toLowerCase()));
    if (isExcluded) {
      utils.log(`[Directory] Skipping excluded builder: ${listing.name}`);
      skippedExcluded++;
      continue;
    }

    // Skip if already in cache with good data
    const existing = builderCache.get(listing.name);
    if (existing && (existing.phone || existing.email)) {
      skippedCached++;
      continue;
    }

    try {
      const detail = await scrapeDetailPage(listing.href, listing.name);
      if (detail) {
        // Merge with any existing cache data (don't overwrite good data with nulls)
        const merged = {
          website: detail.website || (existing && existing.website) || null,
          phone: detail.phone || (existing && existing.phone) || null,
          email: detail.email || (existing && existing.email) || null,
          allPhones: detail.allPhones.length > 0 ? detail.allPhones : (existing && existing.allPhones) || [],
          allEmails: detail.allEmails.length > 0 ? detail.allEmails : (existing && existing.allEmails) || [],
          contactPerson: detail.contactPerson || (existing && existing.contactPerson) || null,
          source: 'charleston-hba-directory',
        };
        builderCache.set(listing.name, merged);
        cached++;
        utils.log(`[Directory] ${listing.name}: ${merged.phone || 'no phone'}, ${merged.email || 'no email'}, ${merged.website || 'no site'}`);
      }
    } catch (err) {
      utils.log(`[Directory] Error on "${listing.name}": ${err.message}`);
      errors++;
    }

    await utils.delay(1500); // Be polite to the server
  }

  // Mark crawl timestamp so we don't re-crawl for 90 days
  builderCache.setDirectoryLastCrawled();

  const stats = builderCache.stats();
  scanStatus = { status: 'completed', total: allListings.length, processed, cached, errors, skippedExcluded, skippedCached, cacheStats: stats };
  if (statusCallback) statusCallback(scanStatus);

  utils.log(`[Directory] Directory scrape complete:`);
  utils.log(`[Directory]   Listings found: ${allListings.length}`);
  utils.log(`[Directory]   Detail pages scraped: ${processed - skippedExcluded - skippedCached}`);
  utils.log(`[Directory]   New cache entries: ${cached}`);
  utils.log(`[Directory]   Skipped (excluded): ${skippedExcluded}`);
  utils.log(`[Directory]   Skipped (already cached): ${skippedCached}`);
  utils.log(`[Directory]   Errors: ${errors}`);
  utils.log(`[Directory]   Cache total: ${stats.total} builders (${stats.withPhone} phone, ${stats.withEmail} email)`);

  return { total: allListings.length, cached, errors, skippedExcluded, skippedCached };
}

module.exports = { scrapeDirectory, getScanStatus };
