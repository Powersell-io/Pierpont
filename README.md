# SC Coastal Permit Tracker

Scrapes building permit data from municipal Citizen Self-Service portals across the Charleston, SC coastal region. Focuses on **new construction** with **approved framing inspections** valued at **$300K+**.

## Quick Start

```bash
npm install
npm start        # Starts server at http://localhost:3000
npm run scrape   # Run scraper standalone (CLI only)
```

## Target Municipalities

| Municipality | Portal Type | Status |
|---|---|---|
| City of Charleston | Accela Citizen Access | Active |
| Town of Mount Pleasant | EnerGov/ViewPoint Cloud | Active |
| Charleston County | County portal (catch-all) | Active |
| Sullivan's Island | County fallback | Via County |
| Isle of Palms | County fallback | Via County |
| Kiawah Island | County fallback | Via County |
| Seabrook Island | County fallback | Via County |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/permits` | List permits (filterable, sortable, paginated) |
| `GET` | `/api/permits/:id` | Single permit details |
| `POST` | `/api/scrape` | Trigger new scrape run |
| `GET` | `/api/scrape/status` | Check scrape progress |
| `GET` | `/api/stats` | Summary statistics |
| `GET` | `/api/export/csv` | Download CSV export |
| `GET` | `/api/scrapers` | Scraper configuration info |

## Configuration

Edit `config.js` to update portal URLs, search parameters, or scraper settings.

## Architecture

- **Backend:** Node.js + Express
- **Scraping:** Puppeteer (JS-rendered portals) + Axios/Cheerio (static HTML)
- **Database:** SQLite via sql.js (pure JS, no native deps)
- **Frontend:** Single-page HTML/CSS/JS with Tailwind CSS
