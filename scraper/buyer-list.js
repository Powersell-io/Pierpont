// Buyer List Lookup — first line of defense for builder contact info
// Loads CSV buyer lists and provides instant local lookup before web scraping
const fs = require('fs');
const path = require('path');
const utils = require('./utils');

const BUYER_LIST_DIR = path.join(__dirname, '..', 'db', 'buyer-lists');

let index = null; // { normalizedEntityName -> { phone, email, name, entityName } }

function normalize(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,?\s*(llc|inc\.?|corp\.?|co\.?|l\.?l\.?c\.?)$/i, '')
    .replace(/[.,]+$/, '')
    .trim();
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current); current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function loadIndex() {
  if (index) return index;
  index = new Map();

  if (!fs.existsSync(BUYER_LIST_DIR)) {
    utils.log('[BuyerList] No buyer-lists directory found');
    return index;
  }

  const files = fs.readdirSync(BUYER_LIST_DIR).filter(f => f.endsWith('.csv'));
  let totalEntries = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(BUYER_LIST_DIR, file), 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length < 2) continue;

      // Parse header to find column indices
      const header = parseCsvLine(lines[0]);
      const cols = {
        entityName: header.findIndex(h => /entity\s*name/i.test(h)),
        firstName: header.findIndex(h => /^first\s*name$/i.test(h)),
        lastName: header.findIndex(h => /^last\s*name$/i.test(h)),
        phone: header.findIndex(h => /wireless\s*1/i.test(h)),
        email: header.findIndex(h => /possible\s*email/i.test(h)),
        sellerEmail: header.findIndex(h => /registered\s*seller.*name/i.test(h)),
      };

      for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        const entityName = (fields[cols.entityName] || '').trim();
        const firstName = (fields[cols.firstName] || '').trim();
        const lastName = (fields[cols.lastName] || '').trim();
        const phone = (fields[cols.phone] || '').trim();
        const email = (fields[cols.email] || '').trim();
        const sellerEmail = cols.sellerEmail >= 0 ? (fields[cols.sellerEmail] || '').trim() : '';

        if (!entityName) continue;

        const entry = {
          entityName,
          name: [firstName, lastName].filter(Boolean).join(' '),
          phone: phone || null,
          email: email || sellerEmail || null,
        };

        // Skip entries with no useful contact info
        if (!entry.phone && !entry.email) continue;

        const key = normalize(entityName);
        if (!key) continue;

        // Keep the entry with the most info (prefer one with both phone + email)
        const existing = index.get(key);
        if (!existing || (!existing.phone && entry.phone) || (!existing.email && entry.email)) {
          index.set(key, entry);
        }

        // Also index by person name if it looks like a person (not an LLC)
        if (firstName && lastName && !/llc|inc|corp|trust|association|partners/i.test(entityName)) {
          const personKey = normalize(`${firstName} ${lastName}`);
          if (personKey && !index.has(personKey)) {
            index.set(personKey, entry);
          }
        }

        totalEntries++;
      }
    } catch (err) {
      utils.log(`[BuyerList] Error loading ${file}: ${err.message}`);
    }
  }

  utils.log(`[BuyerList] Loaded ${index.size} unique entries from ${files.length} buyer lists (${totalEntries} total rows)`);
  return index;
}

/**
 * Look up a builder/company name against buyer lists.
 * Returns { phone, email, name, entityName, source: 'buyer-list' } or null.
 */
function lookup(companyName) {
  const idx = loadIndex();
  if (idx.size === 0) return null;

  const key = normalize(companyName);
  if (!key) return null;

  // Exact match
  if (idx.has(key)) {
    const entry = idx.get(key);
    return { ...entry, source: 'buyer-list' };
  }

  // Substring match — check if any indexed name contains or is contained by the search
  for (const [indexedKey, entry] of idx) {
    if (indexedKey.includes(key) || key.includes(indexedKey)) {
      if (indexedKey.length >= 4 && key.length >= 4) { // Avoid tiny false matches
        return { ...entry, source: 'buyer-list' };
      }
    }
  }

  return null;
}

/**
 * Get stats about the loaded buyer lists.
 */
function stats() {
  const idx = loadIndex();
  const entries = [...idx.values()];
  return {
    totalEntries: idx.size,
    withPhone: entries.filter(e => e.phone).length,
    withEmail: entries.filter(e => e.email).length,
    withBoth: entries.filter(e => e.phone && e.email).length,
  };
}

/**
 * Reload the index (e.g., after adding new CSV files).
 */
function reload() {
  index = null;
  return loadIndex();
}

module.exports = { lookup, stats, reload, loadIndex };
