// Shared scraping utilities for SC Permit Tracker
const config = require('../config');
const path = require('path');
const fs = require('fs');

// Get a random user agent
function getRandomUserAgent() {
  const agents = config.scraper.userAgents;
  return agents[Math.floor(Math.random() * agents.length)];
}

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry with exponential backoff
async function withRetry(fn, { maxRetries = config.scraper.maxRetries, baseDelay = config.scraper.retryBaseDelayMs, label = '' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const waitTime = baseDelay * Math.pow(2, attempt - 1);
      log(`⚠️  ${label} attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${waitTime}ms...`);
      if (attempt < maxRetries) {
        await delay(waitTime);
      }
    }
  }
  throw lastError;
}

// Timestamped logging
function log(message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] ${message}`);
}

// Save screenshot for debugging
async function saveScreenshot(page, name) {
  try {
    const dir = config.scraper.screenshotDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filename = `${name}-${Date.now()}.png`;
    const filepath = path.join(dir, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    log(`📸 Screenshot saved: ${filepath}`);
    return filepath;
  } catch (err) {
    log(`⚠️  Failed to save screenshot: ${err.message}`);
    return null;
  }
}

// Parse dollar value from string (e.g., "$1,500,000.00" → 1500000)
function parseDollarValue(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[^0-9.]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) ? null : value;
}

// Format date to YYYY-MM-DD
function formatDate(date) {
  if (!date) return null;
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  // Try to parse common date formats
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return String(date);
  return parsed.toISOString().split('T')[0];
}

// Get date range for scraping (last N days)
function getDateRange(days = config.scraper.defaultDateRangeDays) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: formatDate(from),
    to: formatDate(to),
    fromDate: from,
    toDate: to,
  };
}

// Determine municipality from address for county-level results
function detectMunicipalityFromAddress(address) {
  if (!address) return null;
  const addr = address.toLowerCase();

  // Specific places first (before generic "charleston" match)
  if (addr.includes("sullivan's island") || addr.includes('sullivans island')) {
    return "Sullivan's Island";
  }
  if (addr.includes('isle of palms') || addr.includes('isle of palm')) {
    return 'Isle of Palms';
  }
  if (addr.includes('kiawah')) {
    return 'Kiawah Island';
  }
  if (addr.includes('seabrook')) {
    return 'Seabrook Island';
  }
  if (addr.includes('folly beach')) {
    return 'City of Folly Beach';
  }
  if (addr.includes('mount pleasant') || addr.includes('mt pleasant') || addr.includes('mt. pleasant')) {
    return 'Town of Mount Pleasant';
  }
  if (addr.includes('north charleston') || addr.includes('n. charleston') || addr.includes('n charleston')) {
    return 'City of North Charleston';
  }
  if (addr.includes('goose creek')) {
    return 'City of Goose Creek';
  }
  if (addr.includes('hanahan')) {
    return 'City of Hanahan';
  }
  if (addr.includes('summerville')) {
    return 'Town of Summerville';
  }
  if (addr.includes('moncks corner') || addr.includes('monks corner')) {
    return 'Town of Moncks Corner';
  }
  if (addr.includes('hilton head') || addr.includes('hhi')) {
    return 'Town of Hilton Head Island';
  }
  if (addr.includes('bluffton')) {
    return 'Town of Bluffton';
  }
  if (addr.includes('hardeeville')) {
    return 'City of Hardeeville';
  }
  if (addr.includes('beaufort') && !addr.includes('beaufort county')) {
    return 'City of Beaufort';
  }
  if (addr.includes('georgetown')) {
    return 'Georgetown County';
  }
  if (addr.includes('walterboro') || addr.includes('colleton')) {
    return 'Colleton County';
  }
  if (addr.includes('kingstree') || addr.includes('williamsburg')) {
    return 'Williamsburg County';
  }
  if (addr.includes('orangeburg')) {
    return 'Orangeburg County';
  }
  if (addr.includes('dorchester') || addr.includes('st. george') || addr.includes('saint george')) {
    return 'Dorchester County';
  }
  if (addr.includes('berkeley') || addr.includes('huger') || addr.includes('jamestown')) {
    return 'Berkeley County';
  }
  // Generic charleston last (after north charleston etc.)
  if (addr.includes('charleston')) {
    return 'City of Charleston';
  }
  return null;
}

// Clean and normalize text
function cleanText(str) {
  if (!str) return null;
  return String(str).replace(/\s+/g, ' ').trim() || null;
}

// Extract phone number from text
function extractPhone(str) {
  if (!str) return null;
  const match = String(str).match(/[\d().\-+\s]{7,}/);
  return match ? match[0].trim() : null;
}

// Extract email from text
function extractEmail(str) {
  if (!str) return null;
  const match = String(str).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

// Create a standardized permit object with defaults
function createPermitRecord(data) {
  return {
    permit_number: data.permit_number || null,
    address: data.address || '',
    municipality: data.municipality || '',
    builder_name: cleanText(data.builder_name),
    builder_company: cleanText(data.builder_company),
    builder_phone: extractPhone(data.builder_phone) || cleanText(data.builder_phone),
    builder_email: extractEmail(data.builder_email) || cleanText(data.builder_email),
    applicant_name: cleanText(data.applicant_name),
    applicant_phone: extractPhone(data.applicant_phone) || cleanText(data.applicant_phone),
    applicant_email: extractEmail(data.applicant_email) || cleanText(data.applicant_email),
    owner_name: cleanText(data.owner_name),
    project_value: parseDollarValue(data.project_value),
    permit_type: cleanText(data.permit_type),
    inspection_type: cleanText(data.inspection_type),
    inspection_date: formatDate(data.inspection_date),
    inspection_status: cleanText(data.inspection_status),
    permit_issue_date: formatDate(data.permit_issue_date),
    source_url: data.source_url || null,
    raw_data: data.raw_data || data,
  };
}

// Calculate opportunity score (0-100) from valuation, recency, and distance
// Weights: 40% valuation, 30% recency, 30% distance
function calculateOpportunityScore({ project_value, inspection_date, municipality }) {
  const driveTimes = config.driveTimesFrom29464;

  // Valuation score: log scale ($100K = 0, $2M+ = 100)
  let val_score = 0;
  if (project_value && project_value > 100000) {
    const logMin = Math.log(100000);
    const logMax = Math.log(2000000);
    val_score = Math.min(100, Math.max(0,
      ((Math.log(project_value) - logMin) / (logMax - logMin)) * 100
    ));
  }

  // Recency score: linear (today = 100, 30 days ago = 0)
  let recent_score = 0;
  if (inspection_date) {
    const inspDate = new Date(inspection_date + (inspection_date.includes('T') ? '' : 'T00:00:00'));
    const now = new Date();
    const daysDiff = (now - inspDate) / (1000 * 60 * 60 * 24);
    recent_score = Math.min(100, Math.max(0, (1 - daysDiff / 30) * 100));
  }

  // Distance score: linear (0 min = 100, 90 min = 0)
  let dist_score = 50; // default if municipality not in map
  if (municipality && driveTimes[municipality] !== undefined) {
    const minutes = driveTimes[municipality];
    dist_score = Math.min(100, Math.max(0, (1 - minutes / 90) * 100));
  }

  const score = Math.round(val_score * 0.4 + recent_score * 0.3 + dist_score * 0.3);

  return {
    score: Math.min(100, Math.max(0, score)),
    components: {
      val_score: Math.round(val_score),
      recent_score: Math.round(recent_score),
      dist_score: Math.round(dist_score),
    },
  };
}

// FUTURE: Contact enrichment via external API
// Will accept builder name/company and owner name/address
// and return verified phone numbers and email addresses
async function enrichContact(permitData) {
  // TODO: Integrate external contact lookup API
  // API details will be provided later
  //
  // Expected usage:
  //   const enriched = await enrichContact({
  //     builder_name: 'John Smith',
  //     builder_company: 'Smith Builders LLC',
  //     owner_name: 'Jane Doe',
  //     address: '123 Main St, Charleston, SC 29401'
  //   });
  //
  // Expected return: { ...permitData, builder_phone, builder_email, owner_phone, owner_email }
  return permitData;
}

module.exports = {
  getRandomUserAgent,
  delay,
  withRetry,
  log,
  saveScreenshot,
  parseDollarValue,
  formatDate,
  getDateRange,
  detectMunicipalityFromAddress,
  cleanText,
  extractPhone,
  extractEmail,
  createPermitRecord,
  calculateOpportunityScore,
  enrichContact,
};
