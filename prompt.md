# CLAUDE CODE PROMPT — SC Coastal Permit Scraper

> **Run with:** `claude --dangerously-skip-permissions`
> **Save this file as:** `permit-scraper-prompt.md` (DO NOT name it `claude.md` — keep it separate from all other Claude config files)

---

## MASTER INSTRUCTION

Build a complete, working, self-contained web application called **"SC Coastal Permit Tracker"** that scrapes building permit data from municipal Citizen Self-Service / permit portals across the Charleston, SC coastal region. The app must be production-ready, handle errors gracefully, and present data in a clean, sortable table. Build the entire thing from scratch — frontend, backend, scraping logic, everything.

---

## TECH STACK

- **Backend:** Node.js with Express
- **Scraping:** Puppeteer (headless Chrome) for JavaScript-rendered citizen self-service portals, plus Axios + Cheerio as fallback for static HTML portals
- **Frontend:** Single-page HTML/CSS/JS served by Express (no React — keep it dead simple)
- **Database:** SQLite via `better-sqlite3` for local caching/storage of scraped results
- **Styling:** Tailwind CSS via CDN for a clean, modern look
- **No authentication required** — this is a local/internal tool

---

## TARGET MUNICIPALITIES & THEIR PERMIT PORTALS

Scrape permits from ALL of the following. Each municipality uses a slightly different portal system (most use CityView, Accela Citizen Access, or EnerGov Citizen Self-Service). You MUST research and find the correct portal URL for each one. Here are the known/likely portals:

### 1. City of Charleston
- **Portal:** Accela Citizen Access — https://epicpa.charleston-sc.gov/CitizenAccess/
- **Alt:** Check https://www.charleston-sc.gov for any updated permit search links

### 2. Town of Mount Pleasant
- **Portal:** EnerGov Citizen Self-Service — https://mtpleasantsc.viewpointcloud.com/
- **Alt:** Check https://www.tompsc.com/157/Building-Inspections

### 3. Sullivan's Island
- **Portal:** May use Charleston County system or their own — check https://www.sullivansisland.sc.gov
- **Fallback:** Charleston County permit portal may cover this jurisdiction

### 4. Isle of Palms
- **Portal:** Check https://www.iop.net for permit search / citizen self-service links
- **Fallback:** May route through Charleston County

### 5. Kiawah Island
- **Portal:** Check https://www.kiawahisland.org — Town of Kiawah Island
- **Note:** Kiawah has its own Architectural Review Board; permits may be through Charleston County portal

### 6. Seabrook Island
- **Portal:** Check https://www.townofseabrookisland.org
- **Note:** May route through Charleston County system

### 7. Charleston County (CATCH-ALL)
- **Portal:** https://www.charlestoncounty.org/departments/building-inspection-services/
- **Note:** Several of the smaller islands (Sullivan's, IOP, Kiawah, Seabrook) may file permits through the county system. ALWAYS include Charleston County as a fallback scrape source.

> **⚠️ IMPORTANT:** If a municipality doesn't have its own portal, default to the Charleston County permit portal and filter by address/jurisdiction. The scraper should be smart enough to handle both scenarios.

---

## SEARCH CRITERIA (EVERY RUN)

Each time the scraper runs, it must search for permits matching ALL of the following:

| Filter | Value |
|--------|-------|
| **Date Range** | Last 30 days from current date |
| **Inspection Type** | "Framing Inspection" (also search variants: "Framing", "Frame", "Rough Framing", "Structural Framing") |
| **Inspection Status** | "Approved" / "Passed" / "Pass" (match any approved-equivalent status) |
| **Permit/Project Value** | ≥ $300,000 (three hundred thousand dollars) |
| **Permit Type** | New Residential Construction / New Single Family / New Home (focus on new builds, not renovations) |

---

## DATA TO EXTRACT PER PERMIT

For EVERY permit that matches the criteria, extract and store:

| Field | Required | Notes |
|-------|----------|-------|
| `permit_number` | ✅ | The official permit/case number |
| `address` | ✅ | Full property address including city, state, zip |
| `municipality` | ✅ | Which jurisdiction (Charleston, Mt Pleasant, etc.) |
| `builder_name` | ✅ | General Contractor / Builder name |
| `builder_company` | ✅ | Builder's company name if listed separately |
| `builder_phone` | ⭐ | If available on the permit record |
| `builder_email` | ⭐ | If available on the permit record |
| `applicant_name` | ✅ | The permit applicant (may be homeowner or builder) |
| `applicant_phone` | ⭐ | If available |
| `applicant_email` | ⭐ | If available |
| `owner_name` | ⭐ | Property owner if listed separately from applicant |
| `project_value` | ✅ | Dollar value of the project |
| `permit_type` | ✅ | Type of permit (new construction, etc.) |
| `inspection_type` | ✅ | The specific inspection that was approved |
| `inspection_date` | ✅ | Date the framing inspection was approved |
| `inspection_status` | ✅ | "Approved" / "Passed" |
| `permit_issue_date` | ⭐ | When the permit was originally issued |
| `scraped_at` | ✅ | Timestamp of when we scraped this record |
| `source_url` | ✅ | Direct link back to the permit record if possible |

> ⭐ = Extract if available, don't fail if missing

---

## APPLICATION STRUCTURE

```
sc-permit-tracker/
├── package.json
├── server.js                    # Express server + API routes
├── scraper/
│   ├── index.js                 # Main scraper orchestrator
│   ├── portals/
│   │   ├── charleston.js        # City of Charleston scraper
│   │   ├── mount-pleasant.js    # Mount Pleasant scraper
│   │   ├── charleston-county.js # County-level scraper (catch-all)
│   │   ├── sullivans-island.js  # Sullivan's Island scraper
│   │   ├── isle-of-palms.js     # Isle of Palms scraper
│   │   ├── kiawah.js            # Kiawah Island scraper
│   │   └── seabrook.js          # Seabrook Island scraper
│   └── utils.js                 # Shared scraping utilities
├── db/
│   ├── init.js                  # SQLite schema + initialization
│   └── permits.db               # SQLite database (auto-created)
├── public/
│   └── index.html               # Single-page frontend
└── README.md
```

---

## FRONTEND REQUIREMENTS

The `public/index.html` file must be a single self-contained HTML file with embedded CSS/JS that includes:

### Header Section
- App title: **"SC Coastal Permit Tracker"**
- Subtitle: "New Construction Framing Inspections — Approved — $300K+"
- A prominent **"🔄 Run Scraper"** button that triggers a fresh scrape via API call
- A loading spinner/progress indicator while scraping is in progress
- Last scraped timestamp display

### Filter Bar
- Date range picker (default: last 30 days)
- Municipality dropdown (All, Charleston, Mt Pleasant, Sullivan's, IOP, Kiawah, Seabrook)
- Min value filter (default: $300,000)
- Search box for filtering by name, address, builder, etc.
- "Export CSV" button

### Results Table
- Sortable columns (click header to sort)
- Columns: Municipality | Address | Builder | Builder Phone | Builder Email | Applicant | Applicant Phone | Applicant Email | Value | Inspection Date | Status | Permit #
- Alternating row colors for readability
- Clicking a row expands to show full details
- Phone numbers should be clickable `tel:` links
- Email addresses should be clickable `mailto:` links
- Empty phone/email fields should show a subtle "—" placeholder
- Pagination if results exceed 50 rows

### Stats Bar (above table)
- Total permits found
- Breakdown by municipality (small badges)
- Average project value
- Date range of results

### Design
- Dark navy header (#1a1a2e or similar)
- White/light gray body
- Green accent for "Approved" status badges
- Clean, professional — like a Bloomberg terminal meets a CRM
- Mobile responsive
- Tailwind CSS via CDN: `<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">`

---

## API ENDPOINTS

```
GET  /                          → Serve the frontend
GET  /api/permits               → Get all stored permits (with query params for filtering)
GET  /api/permits/:id           → Get single permit details
POST /api/scrape                → Trigger a new scrape run
GET  /api/scrape/status         → Check if a scrape is currently running
GET  /api/export/csv            → Download results as CSV
GET  /api/stats                 → Get summary statistics
```

### Query Parameters for `/api/permits`:
- `municipality` — filter by municipality
- `min_value` — minimum project value
- `max_value` — maximum project value
- `date_from` — inspection date start
- `date_to` — inspection date end
- `search` — full-text search across all fields
- `sort_by` — column to sort by
- `sort_order` — asc/desc
- `page` — pagination page number
- `per_page` — results per page (default 50)

---

## SCRAPER LOGIC

### General Approach
1. **For Accela-based portals** (Charleston): Use Puppeteer to navigate the search form, fill in date ranges and permit types, submit, and parse the results table. Then click into each permit record to get full details including contractor/applicant info.

2. **For EnerGov/ViewPoint portals** (Mount Pleasant): These often have API endpoints under the hood. Check for XHR requests in the network tab that return JSON. If found, hit those APIs directly with Axios instead of scraping HTML. If not, use Puppeteer.

3. **For smaller municipalities** that route through Charleston County: Scrape Charleston County's portal and filter results by address (look for Sullivan's Island, Isle of Palms, Kiawah, Seabrook in the address field).

### Scraper Robustness
- **Retry logic:** 3 retries with exponential backoff on failures
- **Rate limiting:** 2-second delay between requests to avoid being blocked
- **User-Agent rotation:** Use realistic browser user-agents
- **Error isolation:** If one municipality's scraper fails, log the error and continue with the others — never let one failure kill the whole run
- **Timeout:** 60-second timeout per page load
- **Screenshot on error:** Save a screenshot when Puppeteer encounters an unexpected page state (for debugging)
- **Logging:** Console log with timestamps for every major step

### Scraper Flow (per municipality)
```
1. Launch browser / navigate to portal
2. Set search filters:
   - Date range: last 30 days
   - Permit type: New Construction / Residential
   - Status: look for approved framing inspections
3. Submit search
4. Parse results list
5. For each result:
   a. Check if project value >= $300,000
   b. Check if there's an approved framing inspection
   c. If both match, click into the detail page
   d. Extract all fields (builder, applicant, owner, contact info, etc.)
   e. Save to database
6. Handle pagination if results span multiple pages
7. Close browser
```

---

## DATABASE SCHEMA

```sql
CREATE TABLE IF NOT EXISTS permits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    permit_number TEXT UNIQUE,
    address TEXT NOT NULL,
    municipality TEXT NOT NULL,
    builder_name TEXT,
    builder_company TEXT,
    builder_phone TEXT,
    builder_email TEXT,
    applicant_name TEXT,
    applicant_phone TEXT,
    applicant_email TEXT,
    owner_name TEXT,
    project_value REAL,
    permit_type TEXT,
    inspection_type TEXT,
    inspection_date TEXT,
    inspection_status TEXT,
    permit_issue_date TEXT,
    source_url TEXT,
    scraped_at TEXT DEFAULT (datetime('now')),
    raw_data TEXT  -- JSON blob of the full scraped record for debugging
);

CREATE INDEX IF NOT EXISTS idx_municipality ON permits(municipality);
CREATE INDEX IF NOT EXISTS idx_inspection_date ON permits(inspection_date);
CREATE INDEX IF NOT EXISTS idx_project_value ON permits(project_value);
CREATE INDEX IF NOT EXISTS idx_builder_name ON permits(builder_name);
```

---

## CRITICAL IMPLEMENTATION NOTES

1. **DO NOT hardcode portal URLs that might change.** Put them in a `config.js` file so they're easy to update.

2. **Each municipality scraper must be its own module** with a consistent interface:
```javascript
// Every scraper module must export this:
module.exports = {
    name: 'City of Charleston',
    slug: 'charleston',
    portalUrl: 'https://...',
    async scrape(options) {
        // options = { dateFrom, dateTo, minValue }
        // returns: Array of permit objects
    }
}
```

3. **Handle the reality that not all portals will work on day one.** For portals you cannot fully automate, create a stub scraper that:
   - Logs a clear message: "⚠️ [Municipality] scraper needs manual configuration — portal structure unknown"
   - Returns an empty array
   - Includes comments with the portal URL and notes on what you observed

4. **The app must start and be usable immediately** even if some scrapers are stubbed out. The frontend should show which municipalities are active vs. pending.

5. **CSV Export** must include ALL fields, properly escaped, with a filename like `permit-tracker-2025-02-28.csv`

6. **Deduplication:** On re-scrapes, update existing records (match on `permit_number`) rather than creating duplicates.

7. **The scraper should be runnable independently** via `node scraper/index.js` for testing, in addition to being triggered via the API.

---

## STARTUP

```bash
# Install dependencies
npm install

# Start the server (runs on port 3000)
npm start

# Or run just the scraper
npm run scrape
```

The server should log:
```
🏗️  SC Coastal Permit Tracker
📡 Server running at http://localhost:3000
💾 Database initialized
🔍 Ready to scrape permits
```

---

## FUTURE EXPANSION (DO NOT BUILD YET — JUST LEAVE HOOKS)

Leave clearly commented placeholder sections for:

1. **Contact Enrichment API** — A future endpoint `POST /api/enrich/:permit_id` that will accept an external API call to look up the homeowner's and builder's full contact information (phone, email, mailing address). Leave a placeholder function in `scraper/utils.js`:
```javascript
// FUTURE: Contact enrichment via external API
// Will accept builder name/company and owner name/address
// and return verified phone numbers and email addresses
async function enrichContact(permitData) {
    // TODO: Integrate external contact lookup API
    // API details will be provided later
    return permitData;
}
```

2. **Automated scheduling** — A cron job that runs the scraper daily at 6 AM EST

3. **Email/SMS alerts** — Notify when new permits matching criteria are found

4. **GoHighLevel webhook** — Push new leads directly into a GHL pipeline

---

## BUILD THIS NOW

Start building immediately. Do not ask clarifying questions. Make your best judgment on any ambiguities. If a portal is behind a login wall or has an unusual structure, create a working stub and document what you found. The goal is a running application that I can open in my browser at `localhost:3000` and see results.

**Go.**
