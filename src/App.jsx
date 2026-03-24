import { useState, useCallback, useRef, useEffect } from "react";

// --- XBRL Tag mappings ---
const REVENUE_TAGS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueGoodsNet",
  "InterestIncomeExpenseNet",
  "RegulatedAndUnregulatedOperatingRevenue",
  "ElectricUtilityRevenue",
  "RealEstateRevenueNet",
  "HealthCareOrganizationRevenue",
  "FinancialServicesRevenue",
  "BrokerageCommissionsRevenue",
  "OilAndGasRevenue",
  "FoodAndBeverageRevenue",
  "TotalRevenuesAndOtherIncome",
  "InterestAndDividendIncomeOperating",
  "NoninterestIncome",
  "RevenuesNetOfInterestExpense",
];

const OPERATING_INCOME_TAGS = [
  "OperatingIncomeLoss",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
];

const DA_TAGS = [
  "DepreciationDepletionAndAmortization",
  "DepreciationAndAmortization",
  "DepreciationAmortizationAndAccretionNet",
  "Depreciation",
  "OtherDepreciationAndAmortization",
];

// --- Helpers ---
function fmtNum(val) {
  if (val == null || isNaN(val)) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(0) + "K";
  return sign + "$" + abs.toFixed(0);
}

function fmtPct(val) {
  if (val == null || isNaN(val) || !isFinite(val)) return "—";
  return (val >= 0 ? "+" : "") + (val * 100).toFixed(1) + "%";
}

function extractMetric(facts, tags) {
  if (!facts?.["us-gaap"]) return null;
  for (const tag of tags) {
    const c = facts["us-gaap"][tag];
    if (c?.units?.USD) return c.units.USD;
  }
  return null;
}

function buildQuarterly(entries) {
  if (!entries) return [];
  const map = {};
  for (const e of entries) {
    if (!e.frame) continue;
    const m = e.frame.match(/^CY(\d{4})Q([1-4])$/);
    if (!m) continue;
    const key = `${m[1]}-Q${m[2]}`;
    if (!map[key] || e.filed > map[key].filed) {
      map[key] = { year: +m[1], q: +m[2], val: e.val, filed: e.filed, label: key };
    }
  }
  return Object.values(map).sort((a, b) => a.year - b.year || a.q - b.q);
}

function buildAnnual(entries) {
  if (!entries) return [];
  const map = {};
  for (const e of entries) {
    if (!e.frame) continue;
    const m = e.frame.match(/^CY(\d{4})$/);
    if (!m) continue;
    const yr = +m[1];
    if (!map[yr] || e.filed > map[yr].filed) {
      map[yr] = { year: yr, val: e.val, filed: e.filed, label: `FY ${yr}` };
    }
  }
  return Object.values(map).sort((a, b) => a.year - b.year);
}

function withYoYQ(data) {
  return data.map((d) => {
    const prev = data.find((p) => p.year === d.year - 1 && p.q === d.q);
    return { ...d, yoy: prev?.val ? (d.val - prev.val) / Math.abs(prev.val) : null };
  });
}

function withYoYA(data) {
  return data.map((d) => {
    const prev = data.find((p) => p.year === d.year - 1);
    return { ...d, yoy: prev?.val ? (d.val - prev.val) / Math.abs(prev.val) : null };
  });
}

// --- Component ---
export default function App() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [company, setCompany] = useState("");
  const [activeTicker, setActiveTicker] = useState("");
  const ref = useRef(null);

  useEffect(() => ref.current?.focus(), []);

  const go = useCallback(async () => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setLoading(true);
    setError(null);
    setData(null);

    try {
      // 1. Resolve ticker → CIK
      const tkRes = await fetch("/api/tickers");
      if (!tkRes.ok) throw new Error("Failed to fetch ticker index");
      const tkData = await tkRes.json();
      let cik = null, name = "";
      for (const k of Object.keys(tkData)) {
        if (tkData[k].ticker === t) {
          cik = tkData[k].cik_str;
          name = tkData[k].title;
          break;
        }
      }
      if (!cik) throw new Error(`Ticker "${t}" not found in SEC EDGAR`);
      setCompany(name);
      setActiveTicker(t);

      // 2. Fetch XBRL facts
      const padded = String(cik).padStart(10, "0");
      const factsRes = await fetch(`/api/facts/${padded}`);
      if (!factsRes.ok) throw new Error("Failed to fetch company facts from EDGAR");
      const facts = (await factsRes.json()).facts;

      // 3. Extract raw
      const revRaw = extractMetric(facts, REVENUE_TAGS);
      const opRaw = extractMetric(facts, OPERATING_INCOME_TAGS);
      const daRaw = extractMetric(facts, DA_TAGS);

      // 4. Build quarterly
      const revAllQ = withYoYQ(buildQuarterly(revRaw));
      const opAllQ = withYoYQ(buildQuarterly(opRaw));
      const daAllQ = buildQuarterly(daRaw);

      // EBITDA quarterly
      const ebitdaAllQ = withYoYQ(
        buildQuarterly(opRaw).map((op) => {
          const da = daAllQ.find((d) => d.year === op.year && d.q === op.q);
          return { ...op, val: op.val + (da?.val || 0) };
        })
      );

      // 5. Build annual
      const revAllA = withYoYA(buildAnnual(revRaw));
      const opAllA = withYoYA(buildAnnual(opRaw));
      const daAllA = buildAnnual(daRaw);

      const ebitdaAllA = withYoYA(
        buildAnnual(opRaw).map((op) => {
          const da = daAllA.find((d) => d.year === op.year);
          return { ...op, val: op.val + (da?.val || 0) };
        })
      );

      // 6. Slice
      const revQ = revAllQ.slice(-8);
      const opQ = opAllQ.slice(-8);
      const ebQ = ebitdaAllQ.slice(-8);
      const revA = revAllA.slice(-3);
      const opA = opAllA.slice(-3);
      const ebA = ebitdaAllA.slice(-3);

      // 7. Margins
      const mQ = revQ.map((r, i) => ({
        opMargin: opQ[i]?.val != null && r.val ? opQ[i].val / r.val : null,
        ebitdaMargin: ebQ[i]?.val != null && r.val ? ebQ[i].val / r.val : null,
      }));
      const mA = revA.map((r, i) => ({
        opMargin: opA[i]?.val != null && r.val ? opA[i].val / r.val : null,
        ebitdaMargin: ebA[i]?.val != null && r.val ? ebA[i].val / r.val : null,
      }));

      setData({
        q: { rev: revQ, op: opQ, eb: ebQ, m: mQ },
        a: { rev: revA, op: opA, eb: ebA, m: mA },
        hasDa: daRaw != null && daRaw.length > 0,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  return (
    <div className="root">
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap"
        rel="stylesheet"
      />
      <style>{globalCSS}</style>

      {/* HEADER */}
      <header className="header">
        <div className="logo">
          <span className="logo-mark">◈</span>
          <span className="logo-title">SEC EDGAR</span>
          <span className="logo-sep">|</span>
          <span className="logo-sub">Financial Dashboard</span>
        </div>
        <div className="search-bar">
          <label className="search-label">TICKER</label>
          <input
            ref={ref}
            className="search-input"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="e.g. AAPL"
            maxLength={10}
          />
          <button className="search-btn" onClick={go} disabled={loading}>
            {loading ? <span className="spin">⟳</span> : "Generate →"}
          </button>
        </div>
      </header>

      {/* COMPANY BANNER */}
      {company && data && (
        <div className="banner">
          <span className="banner-tick">{activeTicker}</span>
          <span className="banner-name">{company}</span>
          <span className="banner-src">Source: SEC EDGAR XBRL</span>
        </div>
      )}

      {error && <div className="error-box">⚠ {error}</div>}

      {loading && (
        <div className="loading">
          <span className="dot" />
          Fetching from SEC EDGAR...
        </div>
      )}

      {!data && !loading && !error && (
        <div className="empty">
          <div className="empty-icon">📊</div>
          <h2>Enter a US-listed ticker above</h2>
          <p className="mono">Revenue · Operating Income · EBITDA · Y/Y Growth · Margins</p>
          <p className="muted">Data sourced directly from SEC EDGAR XBRL filings</p>
        </div>
      )}

      {/* TABLES */}
      {data && (
        <div className="grid">
          <Panel
            title="Quarterly (Last 8)"
            badge="10-Q / 10-K"
            data={data.q}
            hasDa={data.hasDa}
          />
          <Panel
            title="Annual (Last 3 FY)"
            badge="10-K"
            data={data.a}
            hasDa={data.hasDa}
          />
        </div>
      )}

      <footer className="footer">
        Data from SEC EDGAR XBRL API · All figures in USD · Not financial advice
      </footer>
    </div>
  );
}

// --- Panel ---
function Panel({ title, badge, data, hasDa }) {
  const { rev, op, eb, m } = data;
  const labels = rev.map((d) => d.label);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="panel-badge">{badge}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Metric</th>
              {labels.map((l, i) => (
                <th key={i}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="Revenue" vals={rev.map((d) => fmtNum(d.val))} cls="" />
            <Row label="Y/Y Growth" vals={rev.map((d) => fmtPct(d.yoy))} cls="sub" colorize={rev.map((d) => d.yoy)} />
            <Spacer cols={labels.length + 1} />
            <Row label="Operating Income" vals={op.map((d) => fmtNum(d.val))} cls="" />
            <Row label="Y/Y Growth" vals={op.map((d) => fmtPct(d.yoy))} cls="sub" colorize={op.map((d) => d.yoy)} />
            <Row label="Op. Margin" vals={m.map((d) => fmtPct(d.opMargin))} cls="sub" colorize={m.map((d) => d.opMargin)} type="margin" />
            <Spacer cols={labels.length + 1} />
            <Row label={hasDa ? "EBITDA" : "EBITDA *"} vals={eb.map((d) => fmtNum(d.val))} cls="" />
            <Row label="Y/Y Growth" vals={eb.map((d) => fmtPct(d.yoy))} cls="sub" colorize={eb.map((d) => d.yoy)} />
            <Row label="EBITDA Margin" vals={m.map((d) => fmtPct(d.ebitdaMargin))} cls="sub" colorize={m.map((d) => d.ebitdaMargin)} type="margin" />
          </tbody>
        </table>
      </div>
      {!hasDa && <p className="footnote">* D&A not reported in XBRL; EBITDA ≈ Operating Income</p>}
    </section>
  );
}

function Row({ label, vals, cls, colorize, type }) {
  return (
    <tr>
      <td className={`sticky-col label ${cls}`}>{label}</td>
      {vals.map((v, i) => {
        let color = "";
        if (colorize) {
          const n = colorize[i];
          if (n == null || isNaN(n) || !isFinite(n)) color = "muted";
          else if (type === "margin") color = n >= 0 ? "blue" : "red";
          else color = n >= 0 ? "green" : "red";
        }
        return (
          <td key={i} className={`num ${color}`}>
            {v}
          </td>
        );
      })}
    </tr>
  );
}

function Spacer({ cols }) {
  return (
    <tr>
      <td colSpan={cols} className="spacer" />
    </tr>
  );
}

// --- CSS ---
const globalCSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #060b18;
    --bg2: #0c1425;
    --bg3: #0a1020;
    --border: #1a2336;
    --text: #e2e8f0;
    --text2: #cbd5e1;
    --muted: #64748b;
    --dim: #475569;
    --accent: #60a5fa;
    --green: #34d399;
    --red: #f87171;
    --blue: #93c5fd;
    --mono: 'JetBrains Mono', monospace;
    --sans: 'DM Sans', system-ui, sans-serif;
  }

  .root {
    font-family: var(--sans);
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg3) 100%);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* HEADER */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 24px; border-bottom: 1px solid var(--border);
    background: rgba(6,11,24,0.95); backdrop-filter: blur(12px);
    flex-wrap: wrap; gap: 12px;
  }
  .logo { display: flex; align-items: center; gap: 8px; }
  .logo-mark { font-size: 22px; color: var(--accent); }
  .logo-title { font-family: var(--mono); font-weight: 700; font-size: 15px; color: #f8fafc; letter-spacing: 1px; }
  .logo-sep { color: #334155; font-size: 18px; }
  .logo-sub { font-size: 13px; color: #94a3b8; font-weight: 500; }

  .search-bar {
    display: flex; align-items: center;
    background: #0f172a; border: 1px solid #1e3a5f;
    border-radius: 8px; padding: 4px 4px 4px 14px; gap: 10px;
  }
  .search-label { font-family: var(--mono); font-size: 10px; font-weight: 600; color: var(--accent); letter-spacing: 2px; }
  .search-input {
    font-family: var(--mono); font-size: 16px; font-weight: 600;
    color: #f8fafc; background: transparent; border: none; outline: none;
    width: 100px; letter-spacing: 2px;
  }
  .search-input::placeholder { color: #334155; }
  .search-btn {
    font-family: var(--sans); font-size: 13px; font-weight: 600;
    color: #0f172a; background: linear-gradient(135deg, #60a5fa, #3b82f6);
    border: none; border-radius: 6px; padding: 8px 18px;
    cursor: pointer; letter-spacing: 0.5px; white-space: nowrap;
    transition: opacity 0.15s;
  }
  .search-btn:hover { opacity: 0.9; }
  .search-btn:disabled { opacity: 0.6; cursor: wait; }
  .spin { display: inline-block; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* BANNER */
  .banner {
    display: flex; align-items: center; gap: 14px;
    padding: 12px 24px; background: var(--bg2);
    border-bottom: 1px solid var(--border); flex-wrap: wrap;
  }
  .banner-tick {
    font-family: var(--mono); font-size: 22px; font-weight: 700;
    color: var(--accent); background: #1e3a5f22;
    padding: 2px 10px; border-radius: 4px;
  }
  .banner-name { font-size: 16px; font-weight: 500; color: var(--text2); }
  .banner-src { font-size: 11px; color: var(--dim); margin-left: auto; font-family: var(--mono); }

  /* STATES */
  .error-box {
    margin: 24px; padding: 14px 20px;
    background: #1a0a0a; border: 1px solid #7f1d1d;
    border-radius: 8px; color: #fca5a5; font-size: 14px;
  }
  .loading {
    display: flex; align-items: center; justify-content: center;
    gap: 12px; padding: 60px 24px; color: #94a3b8; font-size: 14px;
  }
  .dot {
    width: 10px; height: 10px; background: var(--accent);
    border-radius: 50%; animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }

  .empty {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 80px 24px; gap: 10px; flex: 1;
  }
  .empty-icon { font-size: 48px; opacity: 0.5; }
  .empty h2 { font-size: 18px; font-weight: 600; color: var(--text2); }
  .empty .mono { font-family: var(--mono); font-size: 13px; color: var(--muted); }
  .empty .muted { font-size: 12px; color: var(--dim); margin-top: 4px; }

  /* GRID */
  .grid {
    display: grid; grid-template-columns: 1fr 1fr;
    flex: 1; min-height: 0;
  }
  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; }
  }

  .panel { display: flex; flex-direction: column; border-right: 1px solid var(--border); min-width: 0; }
  .panel-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 18px; border-bottom: 1px solid var(--border);
    background: var(--bg2);
  }
  .panel-title { font-size: 13px; font-weight: 600; color: #94a3b8; letter-spacing: 0.5px; }
  .panel-badge {
    font-family: var(--mono); font-size: 10px;
    color: var(--dim); background: #1e293b;
    padding: 2px 8px; border-radius: 4px;
  }

  .table-wrap { overflow: auto; flex: 1; }
  table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 12px; }

  th {
    padding: 8px 12px; text-align: right; font-weight: 600;
    font-size: 10px; color: var(--muted); letter-spacing: 1.5px;
    text-transform: uppercase; border-bottom: 2px solid #1e293b;
    white-space: nowrap; position: sticky; top: 0;
    background: var(--bg3); z-index: 1;
  }
  th.sticky-col { text-align: left; left: 0; z-index: 2; }

  td { padding: 6px 12px; border-bottom: 1px solid #111827; }
  td.label {
    text-align: left; font-family: var(--sans); font-weight: 600;
    font-size: 12px; color: var(--text2); white-space: nowrap;
    position: sticky; left: 0; background: var(--bg3);
  }
  td.label.sub { font-weight: 400; font-size: 11px; color: #94a3b8; padding-left: 20px; }
  td.num { text-align: right; font-weight: 500; color: var(--text); white-space: nowrap; }
  td.num.green { color: var(--green); }
  td.num.red { color: var(--red); }
  td.num.blue { color: var(--blue); }
  td.num.muted { color: var(--muted); }
  td.spacer { height: 6px; padding: 0; border-bottom: 1px solid #1e293b; }

  .footnote { padding: 6px 18px; font-size: 10px; color: var(--dim); font-style: italic; }

  .footer {
    padding: 12px 24px; border-top: 1px solid var(--border);
    text-align: center; font-size: 11px; color: #334155;
    font-family: var(--mono);
  }

  ::-webkit-scrollbar { height: 6px; width: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: #2a3548; border-radius: 3px; }
`;
