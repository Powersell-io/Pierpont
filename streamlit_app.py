"""
Pierpont Money Printer — SC Lowcountry Construction Lead Intelligence
Streamlit Cloud Dashboard
"""

import streamlit as st
import sqlite3
import pandas as pd
import os
import math
import base64
from datetime import datetime
from urllib.parse import quote

# ─── Page Config ────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Pierpont Money Printer",
    page_icon="🏗️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ─── Constants ──────────────────────────────────────────────────────────────
APP_PASSWORD = "Bulleit"
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "db", "permits.db"))
ENERGOV_BASE = "https://egcss.charleston-sc.gov/EnerGov_Prod/selfservice"

# Logo embedded as base64 so it works on Streamlit Cloud
LOGO_B64 = ""
_logo_path = os.path.join(os.path.dirname(__file__), "public", "logo.png")
if os.path.exists(_logo_path):
    with open(_logo_path, "rb") as f:
        LOGO_B64 = base64.b64encode(f.read()).decode()

DRIVE_TIMES = {
    "Town of Mount Pleasant": 0, "Sullivan's Island": 15, "City of Charleston": 20,
    "Isle of Palms": 20, "Charleston County": 20, "City of North Charleston": 25,
    "City of Hanahan": 25, "Kiawah Island": 35, "Seabrook Island": 35,
    "City of Folly Beach": 35, "Town of Summerville": 35, "City of Goose Creek": 35,
    "Berkeley County": 45, "Dorchester County": 45, "Town of Moncks Corner": 50,
    "Georgetown County": 70, "Colleton County": 70, "Town of Bluffton": 75,
    "City of Beaufort": 80, "Town of Hilton Head Island": 80, "City of Hardeeville": 85,
    "Williamsburg County": 85, "Orangeburg County": 85,
}

FOIA_BODY = """To Whom It May Concern,

Pursuant to the South Carolina Freedom of Information Act, I am a taxpaying citizen requesting the following records for research purposes only:

A list of all strapping inspections (also known as strap/banding inspections) that received a passing status within the last 90 days, including permit number, property address, contractor/builder name, inspection date, and status.

Thank you for your time."""

FOIA_MUNICIPALITIES = [
    {"name": "City of Folly Beach", "type": "email", "email": "permits@follybeach.gov", "drive": 35},
    {"name": "City of Hanahan", "type": "portal", "url": "https://cityofhanahansc.nextrequest.com/requests/new", "portal_name": "NextRequest Portal", "drive": 25},
    {"name": "Town of Moncks Corner", "type": "email", "email": "info@monckscornersc.gov", "drive": 50},
    {"name": "Georgetown County", "type": "email", "email": "cityfoiarequest@georgetownsc.gov", "drive": 70},
    {"name": "Colleton County", "type": "email", "email": "foia@colletoncounty.org", "drive": 70},
    {"name": "City of Beaufort", "type": "portal", "url": "https://beaufortcountysc.justfoia.com/publicportal/home/newrequest", "portal_name": "JustFOIA Portal", "drive": 80},
    {"name": "Williamsburg County", "type": "email", "email": "FOIA-Request@wc.sc.gov", "drive": 85},
    {"name": "Orangeburg County", "type": "email", "email": "foia@orangeburgcounty.org", "drive": 85},
]


# ─── Custom CSS ─────────────────────────────────────────────────────────────
def inject_css():
    st.markdown("""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');

    .stApp { font-family: 'Fira Sans', system-ui, sans-serif; }
    .main .block-container { padding-top: 0.5rem; max-width: 100%; }

    /* Header bar */
    .header-bar {
        background: rgba(15,23,42,0.85);
        backdrop-filter: blur(30px);
        border: 1px solid rgba(255,255,255,0.1);
        border-top: 3px solid #2B6CB0;
        border-radius: 0 0 16px 16px;
        padding: 16px 24px;
        margin-bottom: 20px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
    }
    .header-left { display:flex; align-items:center; gap:12px; }
    .header-logo { height:48px; width:auto; border-radius:6px; }
    .header-title {
        font-family: 'Fira Code', monospace;
        font-weight: 700; font-size: 1.5rem;
        background: linear-gradient(135deg, #3B82C4, #2B6CB0, #6B7B8D);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        margin: 0; line-height: 1.2;
    }
    .header-sub {
        font-size: .75rem; color: #94A3B8; font-weight: 300;
        letter-spacing: 0.05em; margin: 0;
    }
    .header-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

    /* Buttons matching original */
    .btn-primary-custom {
        background: linear-gradient(135deg, #3B82C4, #2B6CB0);
        color: white; font-weight: 600; border: none; border-radius: 12px;
        padding: 10px 20px; cursor: pointer; font-size: .85rem;
        box-shadow: 0 4px 15px rgba(43,108,176,0.3);
        display: inline-flex; align-items: center; gap: 6px;
        text-decoration: none;
    }
    .btn-primary-custom:hover { box-shadow: 0 6px 20px rgba(43,108,176,0.5); }
    .btn-glass-custom {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        color: #E2E8F0; border-radius: 10px;
        padding: 8px 16px; cursor: pointer; font-size: .85rem;
        display: inline-flex; align-items: center; gap: 6px;
        text-decoration: none;
    }
    .btn-glass-custom:hover { background: rgba(255,255,255,0.12); }

    /* Stat cards */
    .stat-card {
        background: rgba(255,255,255,0.04);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 16px;
        padding: 20px;
    }
    .stat-label {
        font-size: .65rem; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.08em; color: #94A3B8; margin-bottom: 8px;
    }
    .stat-value {
        font-family: 'Fira Code', monospace;
        font-size: 1.75rem; font-weight: 700;
        background: linear-gradient(135deg, #F8FAFC, #E2E8F0);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .stat-value-blue {
        font-family: 'Fira Code', monospace;
        font-size: 1.75rem; font-weight: 700;
        background: linear-gradient(135deg, #2B6CB0, #3B82C4);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }

    /* Badges */
    .badge { display:inline-flex;align-items:center;padding:3px 10px;border-radius:9999px;font-size:.7rem;font-weight:600;font-family:'Fira Code',monospace; }
    .badge-green { background:rgba(34,197,94,0.15);color:#4ADE80;border:1px solid rgba(34,197,94,0.2); }
    .badge-yellow { background:rgba(234,179,8,0.15);color:#FDE047;border:1px solid rgba(234,179,8,0.2); }
    .badge-red { background:rgba(239,68,68,0.15);color:#FCA5A5;border:1px solid rgba(239,68,68,0.2); }
    .badge-gray { background:rgba(148,163,184,0.1);color:#94A3B8;border:1px solid rgba(148,163,184,0.15); }

    /* Login */
    .login-card {
        background: rgba(255,255,255,0.06);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 20px;
        padding: 40px;
        max-width: 380px;
        margin: 10vh auto 20px auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        text-align: center;
    }
    .login-logo { height:64px; margin-bottom:16px; }
    .login-title {
        font-family: 'Fira Code', monospace;
        font-size: 1.3rem; font-weight: 700;
        background: linear-gradient(135deg, #3B82C4, #2B6CB0, #6B7B8D);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        margin-bottom: 4px;
    }
    .login-sub { font-size:.75rem; color:#94A3B8; margin-bottom:28px; letter-spacing:.04em; }

    /* FOIA */
    .foia-card {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        padding: 12px 16px;
        display: flex; align-items: center; justify-content: space-between;
    }
    .foia-name { font-size: .85rem; font-weight: 500; color: #F8FAFC; }
    .foia-detail { font-size: .65rem; color: #94A3B8; }
    .foia-link {
        background: rgba(43,108,176,0.1); color: #93C5FD;
        border: 1px solid rgba(43,108,176,0.2);
        padding: 6px 14px; border-radius: 8px;
        font-size: .75rem; font-weight: 600; text-decoration: none;
    }

    /* Hide Streamlit chrome */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    .stDeployButton {display: none;}
    header[data-testid="stHeader"] {background: transparent; height: 0; min-height: 0; padding: 0;}
    div[data-testid="stStatusWidget"] {display: none;}

    /* Ambient background */
    .stApp::before {
        content: '';
        position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
        background: radial-gradient(ellipse at 20% 50%, rgba(43,108,176,0.08) 0%, transparent 50%),
                    radial-gradient(ellipse at 80% 20%, rgba(107,123,141,0.06) 0%, transparent 50%);
        pointer-events: none; z-index: 0;
    }

    /* Data table */
    .permit-table { width:100%; border-collapse:collapse; font-size:.78rem; }
    .permit-table thead th {
        padding:12px 12px; text-align:left;
        font-size:.6rem; font-weight:600; text-transform:uppercase; letter-spacing:.08em;
        color:#94A3B8; background:rgba(15,23,42,0.5);
        border-bottom:1px solid rgba(255,255,255,0.06);
        position:sticky; top:0; z-index:10;
    }
    .permit-table tbody tr { border-bottom:1px solid rgba(255,255,255,0.03); }
    .permit-table tbody tr:hover { background:rgba(43,108,176,0.06); }
    .permit-table tbody td { padding:10px 12px; vertical-align:middle; }
    .permit-table .hv { border-left:3px solid #2B6CB0; }
    .empty-cell { color:rgba(148,163,184,0.4); }
    </style>
    """, unsafe_allow_html=True)


# ─── Database ───────────────────────────────────────────────────────────────
@st.cache_resource
def get_db():
    db_dir = os.path.dirname(DB_PATH)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS permits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            permit_number TEXT UNIQUE, address TEXT NOT NULL, municipality TEXT NOT NULL,
            builder_name TEXT, builder_company TEXT, builder_phone TEXT, builder_email TEXT,
            applicant_name TEXT, applicant_phone TEXT, applicant_email TEXT, owner_name TEXT,
            project_value REAL, permit_type TEXT, inspection_type TEXT, inspection_date TEXT,
            inspection_status TEXT, permit_issue_date TEXT, source_url TEXT,
            scraped_at TEXT DEFAULT (datetime('now')), raw_data TEXT,
            is_drywall_opportunity INTEGER DEFAULT 0, opportunity_confidence TEXT,
            opportunity_signals TEXT, estimated_drywall_date TEXT,
            opportunity_score INTEGER, builder_website TEXT, personal_phone TEXT, personal_email TEXT
        )
    """)
    conn.commit()
    return conn


def query_permits(conn, filters=None, sort_by="opportunity_score", sort_order="DESC", page=1, per_page=50):
    conditions, values = [], []
    if filters:
        if filters.get("search"):
            s = f"%{filters['search']}%"
            conditions.append("(address LIKE ? OR municipality LIKE ? OR builder_name LIKE ? OR builder_company LIKE ? OR owner_name LIKE ? OR permit_number LIKE ? OR builder_phone LIKE ? OR builder_email LIKE ?)")
            values.extend([s] * 8)
        if filters.get("municipality"):
            conditions.append("municipality = ?"); values.append(filters["municipality"])
        if filters.get("date_from"):
            conditions.append("inspection_date >= ?"); values.append(filters["date_from"])
        if filters.get("date_to"):
            conditions.append("inspection_date <= ?"); values.append(filters["date_to"])
        if filters.get("min_value"):
            conditions.append("project_value >= ?"); values.append(float(filters["min_value"]))
        if filters.get("max_value"):
            conditions.append("project_value <= ?"); values.append(float(filters["max_value"]))
        if filters.get("max_drive_time"):
            in_range = [n for n, m in DRIVE_TIMES.items() if m <= int(filters["max_drive_time"])]
            if in_range:
                conditions.append(f"municipality IN ({','.join(['?']*len(in_range))})")
                values.extend(in_range)
            else:
                conditions.append("1=0")
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    allowed = ["municipality","address","builder_name","project_value","inspection_date","opportunity_score","permit_number"]
    if sort_by not in allowed: sort_by = "opportunity_score"
    total = (conn.execute(f"SELECT COUNT(*) FROM permits {where}", values).fetchone() or [0])[0]
    rows = conn.execute(f"SELECT * FROM permits {where} ORDER BY {sort_by} {sort_order} LIMIT ? OFFSET ?", values + [per_page, (page-1)*per_page]).fetchall()
    return {"data": [dict(r) for r in rows], "total": total, "page": page, "per_page": per_page, "total_pages": max(1, math.ceil(total / per_page))}


def get_stats(conn):
    row = conn.execute("SELECT COUNT(*) as t, COALESCE(AVG(project_value),0) as a, MIN(inspection_date) as mi, MAX(inspection_date) as ma FROM permits").fetchone()
    hv = conn.execute("SELECT COUNT(*) FROM permits WHERE project_value >= 300000").fetchone()
    return {"total": row[0], "avg": row[1], "earliest": row[2], "latest": row[3], "hv": hv[0] if hv else 0}


def get_municipalities(conn):
    return [r[0] for r in conn.execute("SELECT DISTINCT municipality FROM permits WHERE municipality IS NOT NULL AND municipality != '' ORDER BY municipality").fetchall()]


# ─── Helpers ────────────────────────────────────────────────────────────────
def score_badge(score):
    if score is None: return '<span class="badge badge-gray">--</span>'
    s = int(score)
    cls = "badge-green" if s >= 70 else "badge-yellow" if s >= 40 else "badge-red" if s >= 1 else "badge-gray"
    return f'<span class="badge {cls}">{s}</span>'

def status_badge(status):
    if not status: return '<span class="badge badge-gray">—</span>'
    l = status.lower()
    cls = "badge-green" if ("pass" in l or "approved" in l) else "badge-yellow" if ("pending" in l or "scheduled" in l) else "badge-gray"
    return f'<span class="badge {cls}">{status}</span>'

def fmt_money(v):
    if v is None or v == 0: return "—"
    return f"${int(v):,}"

def fmt_date(d):
    if not d: return "—"
    try: return datetime.strptime(d[:10], "%Y-%m-%d").strftime("%b %d, %Y")
    except: return d

def esc(s):
    if s is None: return ""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# ─── Login Page ─────────────────────────────────────────────────────────────
def check_auth():
    if "authenticated" not in st.session_state:
        st.session_state.authenticated = False
    if st.session_state.authenticated:
        return True

    inject_css()

    logo_img = f'<img src="data:image/png;base64,{LOGO_B64}" class="login-logo">' if LOGO_B64 else ""

    st.markdown(f"""
    <div class="login-card">
        {logo_img}
        <div class="login-title">Pierpont Money Printer</div>
        <div class="login-sub">SC Lowcountry Construction Lead Intelligence</div>
    </div>
    """, unsafe_allow_html=True)

    col1, col2, col3 = st.columns([1.2, 1, 1.2])
    with col2:
        password = st.text_input("Password", type="password", placeholder="Enter password", label_visibility="collapsed")
        if st.button("Sign In", use_container_width=True, type="primary"):
            if password == APP_PASSWORD:
                st.session_state.authenticated = True
                st.rerun()
            else:
                st.error("Incorrect password")
    return False


# ─── Main Dashboard ────────────────────────────────────────────────────────
def main():
    if not check_auth():
        return

    inject_css()
    conn = get_db()

    # ── Header (HTML to match original) ──
    logo_html = f'<img src="data:image/png;base64,{LOGO_B64}" class="header-logo">' if LOGO_B64 else ""
    st.markdown(f"""
    <div class="header-bar">
        <div class="header-left">
            {logo_html}
            <div>
                <div class="header-title">Pierpont Money Printer</div>
                <div class="header-sub">SC Lowcountry Construction Lead Intelligence</div>
            </div>
        </div>
        <div class="header-right">
            <span class="btn-glass-custom" title="Auto-scrape at 7am, 1pm, 6pm EST">
                🕐 Auto: ON
            </span>
        </div>
    </div>
    """, unsafe_allow_html=True)

    # ── Action buttons row (Streamlit buttons for interactivity) ──
    btn_cols = st.columns([1, 1, 1, 1, 1, 1])
    with btn_cols[0]:
        run_scraper = st.button("🔄 Run Scraper", type="primary", use_container_width=True)
    with btn_cols[1]:
        lookup_builders = st.button("🔍 Lookup Builders", use_container_width=True)
    with btn_cols[2]:
        export_csv = st.button("📥 Export CSV", use_container_width=True)
    with btn_cols[5]:
        logout = st.button("🚪 Logout", use_container_width=True)

    if run_scraper:
        st.info("⚠️ The scraper requires Node.js + Puppeteer and must be run locally with `node server.js`. This Streamlit dashboard is a read-only view of the scraped data.")
    if lookup_builders:
        st.info("⚠️ Builder lookup requires the Node.js server running locally. Start it with `node server.js` and use the lookup feature there.")
    if logout:
        st.session_state.authenticated = False
        st.rerun()

    # ── Stats Cards ──
    stats = get_stats(conn)
    st.markdown("")
    sc = st.columns(4)
    with sc[0]:
        st.markdown(f'<div class="stat-card"><div class="stat-label">Total Permits</div><div class="stat-value">{stats["total"]:,}</div></div>', unsafe_allow_html=True)
    with sc[1]:
        st.markdown(f'<div class="stat-card"><div class="stat-label">Avg Value</div><div class="stat-value">{fmt_money(stats["avg"])}</div></div>', unsafe_allow_html=True)
    with sc[2]:
        st.markdown(f'<div class="stat-card"><div class="stat-label">$300K+ Projects</div><div class="stat-value-blue">{stats["hv"]:,}</div></div>', unsafe_allow_html=True)
    with sc[3]:
        dr = f'{fmt_date(stats["earliest"])} — {fmt_date(stats["latest"])}' if stats["earliest"] else "—"
        st.markdown(f'<div class="stat-card"><div class="stat-label">Date Range</div><div style="font-family:Fira Code,monospace;font-size:.85rem;color:#E2E8F0;margin-top:8px">{dr}</div></div>', unsafe_allow_html=True)

    st.markdown("")

    # ── Filters ──
    municipalities = get_municipalities(conn)
    with st.expander("🔍 Filters", expanded=False):
        fc1, fc2 = st.columns([3, 1])
        with fc1:
            search = st.text_input("Search", placeholder="Address, builder, phone, email, permit #...", label_visibility="collapsed", key="search")
        with fc2:
            dist_opts = {"All distances": "", "15 min": "15", "30 min": "30", "45 min": "45", "60 min": "60", "90 min": "90"}
            max_drive = st.selectbox("Distance", list(dist_opts.keys()), label_visibility="collapsed")
        fc3, fc4, fc5, fc6, fc7 = st.columns(5)
        with fc3:
            muni = st.selectbox("Municipality", ["All"] + municipalities, label_visibility="collapsed")
        with fc4:
            date_from = st.date_input("From", value=None, label_visibility="collapsed")
        with fc5:
            date_to = st.date_input("To", value=None, label_visibility="collapsed")
        with fc6:
            min_val = st.number_input("Min $", min_value=0, value=0, step=50000, label_visibility="collapsed", format="%d")
        with fc7:
            max_val = st.number_input("Max $", min_value=0, value=0, step=50000, label_visibility="collapsed", format="%d")

    filters = {}
    if search: filters["search"] = search
    if dist_opts[max_drive]: filters["max_drive_time"] = dist_opts[max_drive]
    if muni != "All": filters["municipality"] = muni
    if date_from: filters["date_from"] = date_from.strftime("%Y-%m-%d")
    if date_to: filters["date_to"] = date_to.strftime("%Y-%m-%d")
    if min_val > 0: filters["min_value"] = min_val
    if max_val > 0: filters["max_value"] = max_val

    # ── Sort ──
    scol1, scol2, scol3 = st.columns([1, 1, 4])
    with scol1:
        sort_map = {"Score ↓": ("opportunity_score","DESC"), "Score ↑": ("opportunity_score","ASC"),
                     "Date ↓": ("inspection_date","DESC"), "Date ↑": ("inspection_date","ASC"),
                     "Value ↓": ("project_value","DESC"), "Value ↑": ("project_value","ASC")}
        sort_choice = st.selectbox("Sort", list(sort_map.keys()), index=0, label_visibility="collapsed")
        sort_by, sort_order = sort_map[sort_choice]
    with scol2:
        per_page = st.selectbox("Per page", [25, 50, 100], index=1, label_visibility="collapsed")

    if "page" not in st.session_state: st.session_state.page = 1
    result = query_permits(conn, filters=filters, sort_by=sort_by, sort_order=sort_order, page=st.session_state.page, per_page=per_page)

    # ── CSV Export ──
    if export_csv and result["data"]:
        df = pd.read_sql_query("SELECT * FROM permits ORDER BY opportunity_score DESC", conn)
        csv_data = df.to_csv(index=False)
        st.download_button("📥 Download CSV File", csv_data, f"pierpont-{datetime.now().strftime('%Y-%m-%d')}.csv", "text/csv")

    # ── Permit Table ──
    if not result["data"]:
        st.markdown("""
        <div style="text-align:center;padding:80px 20px">
            <div style="font-size:2rem;margin-bottom:12px;opacity:0.3">🔍</div>
            <div style="font-size:1.1rem;font-weight:500;color:#F8FAFC;margin-bottom:8px">No permits loaded</div>
            <div style="color:#94A3B8">Click <strong style="color:#2B6CB0">Run Scraper</strong> on your local server to fetch permits, then refresh this page.</div>
        </div>
        """, unsafe_allow_html=True)
    else:
        start = (result["page"]-1) * result["per_page"] + 1
        end = min(result["page"] * result["per_page"], result["total"])
        st.markdown(f"<div style='font-size:.75rem;color:#94A3B8;font-family:Fira Code,monospace;margin-bottom:4px'>{start}–{end} of {result['total']:,} permits</div>", unsafe_allow_html=True)

        # Build HTML table matching original
        rows_html = ""
        for p in result["data"]:
            is_hv = p.get("project_value") and p["project_value"] >= 300000
            hv_cls = ' class="hv"' if is_hv else ""
            val_style = "color:#2B6CB0;" if is_hv else ""

            # Builder
            bn, bc = p.get("builder_name"), p.get("builder_company")
            if bn and bc:
                builder = f"<div style='font-weight:500;color:#F8FAFC'>{esc(bn)}</div><div style='font-size:.65rem;color:#94A3B8'>{esc(bc)}</div>"
            elif bn or bc:
                builder = f"<span style='font-weight:500;color:#F8FAFC'>{esc(bn or bc)}</span>"
            else:
                builder = '<span class="empty-cell">—</span>'

            # Phone / Email
            ph = f"<a href='tel:{esc(p['builder_phone'])}' style='color:#60A5FA;text-decoration:none;font-family:Fira Code,monospace;font-size:.7rem;white-space:nowrap'>{esc(p['builder_phone'])}</a>" if p.get("builder_phone") else '<span class="empty-cell">—</span>'
            em = f"<a href='mailto:{esc(p['builder_email'])}' style='color:#60A5FA;text-decoration:none;font-size:.7rem'>{esc(p['builder_email'])}</a>" if p.get("builder_email") else '<span class="empty-cell">—</span>'

            # Personal contacts
            pph = f"<span style='font-family:Fira Code,monospace;font-size:.7rem;color:#94A3B8'>{esc(p['personal_phone'])}</span>" if p.get("personal_phone") else '<span class="empty-cell">—</span>'
            pem = f"<span style='font-size:.7rem;color:#94A3B8'>{esc(p['personal_email'])}</span>" if p.get("personal_email") else '<span class="empty-cell">—</span>'

            rows_html += f"""<tr{hv_cls}>
                <td style="color:#F8FAFC;font-weight:500;max-width:180px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="{esc(p.get('address',''))}">{esc(p.get('address')) or '—'}</div></td>
                <td style="color:#94A3B8;font-size:.7rem">{esc(p.get('municipality')) or '—'}</td>
                <td>{builder}</td>
                <td>{ph}</td>
                <td>{em}</td>
                <td>{pph}</td>
                <td>{pem}</td>
                <td style="color:#E2E8F0">{esc(p.get('owner_name')) or '—'}</td>
                <td style="text-align:right;font-family:Fira Code,monospace;font-size:.75rem;{val_style}">{fmt_money(p.get('project_value'))}</td>
                <td style="font-family:Fira Code,monospace;font-size:.7rem;color:#E2E8F0">{fmt_date(p.get('inspection_date'))}</td>
                <td style="text-align:center">{status_badge(p.get('inspection_status'))}</td>
                <td style="text-align:center">{score_badge(p.get('opportunity_score'))}</td>
                <td style="font-family:Fira Code,monospace;font-size:.65rem;color:#94A3B8">{esc(p.get('permit_number')) or '—'}</td>
            </tr>"""

        st.markdown(f"""
        <div style="overflow-x:auto;border-radius:16px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);position:relative">
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:400px;height:400px;background:url('data:image/png;base64,{LOGO_B64}') no-repeat center center;background-size:contain;opacity:0.06;pointer-events:none;z-index:0"></div>
            <table class="permit-table" style="position:relative;z-index:1">
            <thead><tr>
                <th>Address</th><th>Municipality</th><th>Builder</th>
                <th>Biz Phone</th><th>Biz Email</th><th>Personal Phone</th><th>Personal Email</th>
                <th>Owner</th><th style="text-align:right">Value</th><th>Date</th>
                <th style="text-align:center">Status</th><th style="text-align:center">Score</th><th>Permit #</th>
            </tr></thead>
            <tbody>{rows_html}</tbody>
            </table>
        </div>
        """, unsafe_allow_html=True)

        # Pagination
        if result["total_pages"] > 1:
            pc = st.columns([2, 1, 1, 1, 2])
            with pc[1]:
                if st.button("◀ Prev", disabled=st.session_state.page <= 1):
                    st.session_state.page -= 1; st.rerun()
            with pc[2]:
                st.markdown(f"<div style='text-align:center;padding:8px;color:#94A3B8;font-family:Fira Code,monospace;font-size:.8rem'>Page {result['page']}/{result['total_pages']}</div>", unsafe_allow_html=True)
            with pc[3]:
                if st.button("Next ▶", disabled=st.session_state.page >= result["total_pages"]):
                    st.session_state.page += 1; st.rerun()

    # ── FOIA Section ──
    st.markdown("")
    with st.expander("📋 FOIA Requests — Municipalities Without Public Portals"):
        st.markdown("<p style='font-size:.8rem;color:#94A3B8;margin-bottom:12px'>These municipalities require a SC FOIA request to obtain permit data.</p>", unsafe_allow_html=True)
        foia_html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">'
        for m in FOIA_MUNICIPALITIES:
            if m["type"] == "email":
                subject = quote("FOIA REQUEST — Strapping Inspections")
                body = quote(FOIA_BODY)
                mailto = f"mailto:{m['email']}?subject={subject}&body={body}"
                foia_html += f'<div class="foia-card"><div><div class="foia-name">{m["name"]}</div><div class="foia-detail">{m["email"]}</div></div><a href="{mailto}" class="foia-link" target="_blank">Send Request</a></div>'
            else:
                foia_html += f'<div class="foia-card"><div><div class="foia-name">{m["name"]}</div><div class="foia-detail">{m["portal_name"]}</div></div><a href="{m["url"]}" class="foia-link" target="_blank">Open Portal</a></div>'
        foia_html += "</div>"
        st.markdown(foia_html, unsafe_allow_html=True)
        st.markdown("")
        st.code(FOIA_BODY, language=None)
        st.caption("📋 Copy the text above and paste it into the FOIA portal request form.")

    # ── Footer ──
    st.markdown('<div style="text-align:center;padding:20px;font-size:.7rem;color:rgba(148,163,184,0.4)">Pierpont Money Printer — SC Lowcountry Construction Lead Intelligence</div>', unsafe_allow_html=True)


if __name__ == "__main__":
    main()
