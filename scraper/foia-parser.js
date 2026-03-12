// FOIA Response Parser — Reads CSV, Excel, and PDF files from county FOIA responses
// and extracts permit data to feed into upsertPermit()

const path = require('path');
const fs = require('fs');

// ─── Column header aliases → our field names ────────────────────────────────
// Each key is our internal field; values are regex patterns that match common FOIA column headers
const HEADER_MAP = [
  { field: 'permit_number',    patterns: [/permit\s*#/i, /permit\s*num/i, /permit\s*no/i, /^permit$/i, /case\s*#/i, /case\s*num/i, /record\s*#/i, /record\s*num/i] },
  { field: 'address',          patterns: [/address/i, /property\s*addr/i, /location/i, /site\s*addr/i, /project\s*addr/i, /property\s*location/i] },
  { field: 'builder_name',     patterns: [/contractor/i, /builder/i, /applicant/i, /company/i, /firm/i, /licensee/i] },
  { field: 'builder_phone',    patterns: [/phone/i, /tel/i, /mobile/i, /cell/i, /contact\s*#/i] },
  { field: 'builder_email',    patterns: [/email/i, /e-mail/i, /contact\s*email/i] },
  { field: 'project_value',    patterns: [/valu/i, /cost/i, /amount/i, /worth/i, /\$/i, /price/i, /estimated/i] },
  { field: 'inspection_date',  patterns: [/insp.*date/i, /date.*insp/i, /inspection\s*date/i, /^date$/i, /pass.*date/i, /completed?\s*date/i] },
  { field: 'inspection_status', patterns: [/status/i, /result/i, /disposition/i, /outcome/i] },
  { field: 'inspection_type',  patterns: [/insp.*type/i, /type.*insp/i, /inspection\s*type/i, /^type$/i] },
  { field: 'owner_name',       patterns: [/owner/i, /property\s*owner/i, /homeowner/i] },
  { field: 'permit_issue_date', patterns: [/issue\s*date/i, /issued/i, /permit\s*date/i] },
];

function matchHeader(headerText) {
  const h = (headerText || '').trim();
  if (!h) return null;
  for (const mapping of HEADER_MAP) {
    for (const pat of mapping.patterns) {
      if (pat.test(h)) return mapping.field;
    }
  }
  return null;
}

// Build a column→field mapping from an array of header strings
function buildColumnMap(headers) {
  const map = {};
  const usedFields = new Set();
  for (let i = 0; i < headers.length; i++) {
    const field = matchHeader(headers[i]);
    if (field && !usedFields.has(field)) {
      map[i] = field;
      usedFields.add(field);
    }
  }
  return map;
}

// Convert a row (array of values) into a permit object using the column map
function rowToPermit(row, columnMap, municipality) {
  const permit = { municipality, source_url: 'FOIA Import' };
  for (const [colIdx, field] of Object.entries(columnMap)) {
    const val = row[Number(colIdx)];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      permit[field] = String(val).trim();
    }
  }
  // Default inspection status for FOIA strapping responses
  if (!permit.inspection_status) {
    permit.inspection_status = 'Passed';
  }
  if (!permit.inspection_type) {
    permit.inspection_type = 'Strapping Inspection (FOIA)';
  }
  return permit;
}

// ─── CSV Parser ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let current = [];
  let inQuotes = false;
  let field = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'; i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field.trim());
        field = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field.trim());
        if (current.some(c => c !== '')) rows.push(current);
        current = [];
        field = '';
        if (ch === '\r') i++;
      } else {
        field += ch;
      }
    }
  }
  // Last row
  current.push(field.trim());
  if (current.some(c => c !== '')) rows.push(current);

  return rows;
}

// ─── Parse uploaded file ────────────────────────────────────────────────────
async function parseFile(filePath, municipality) {
  const ext = path.extname(filePath).toLowerCase();
  let rows = [];
  let headers = [];

  if (ext === '.csv' || ext === '.txt') {
    const text = fs.readFileSync(filePath, 'utf-8');
    const allRows = parseCSV(text);
    if (allRows.length < 2) return { error: 'File has no data rows', permits: [] };
    headers = allRows[0];
    rows = allRows.slice(1);

  } else if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (data.length < 2) return { error: 'Spreadsheet has no data rows', permits: [] };
    headers = data[0].map(h => String(h));
    rows = data.slice(1);

  } else if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const pdf = await pdfParse(buffer);
    const text = pdf.text;

    // Try to detect tabular data from PDF text
    // PDFs often render tables as lines of text with inconsistent spacing
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Strategy: find a line that looks like headers (matches multiple known patterns)
    let headerLineIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      let score = 0;
      for (const mapping of HEADER_MAP) {
        for (const pat of mapping.patterns) {
          if (pat.test(lines[i])) { score++; break; }
        }
      }
      if (score > bestScore) { bestScore = score; headerLineIdx = i; }
    }

    if (bestScore < 2) {
      // Can't find structured data — return the raw text for manual review
      return {
        error: 'Could not detect tabular data in PDF. The raw text is included below for review.',
        rawText: text,
        permits: [],
      };
    }

    // Split header and data lines by multiple spaces or tabs
    const splitLine = (line) => line.split(/\s{2,}|\t/).map(s => s.trim()).filter(s => s);
    headers = splitLine(lines[headerLineIdx]);
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const parts = splitLine(lines[i]);
      if (parts.length >= 2) rows.push(parts);
    }

  } else {
    return { error: `Unsupported file type: ${ext}. Please upload CSV, Excel (.xlsx/.xls), or PDF.`, permits: [] };
  }

  // Build column mapping
  const columnMap = buildColumnMap(headers);
  const mappedFields = Object.values(columnMap);

  if (mappedFields.length < 2) {
    return {
      error: `Could not map enough columns. Only recognized: ${mappedFields.join(', ') || 'none'}. Headers found: ${headers.join(', ')}`,
      permits: [],
      headers,
    };
  }

  // Parse rows into permits
  const permits = [];
  const skipped = [];
  for (const row of rows) {
    const permit = rowToPermit(row, columnMap, municipality);
    // Must have at least an address to be useful
    if (permit.address) {
      permits.push(permit);
    } else {
      skipped.push(row);
    }
  }

  return {
    permits,
    totalRows: rows.length,
    mappedColumns: Object.entries(columnMap).map(([idx, field]) => ({ column: headers[Number(idx)], mappedTo: field })),
    skippedRows: skipped.length,
    headers,
  };
}

module.exports = { parseFile, matchHeader, buildColumnMap };
