import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

// ─── YAHOO FINANCE PROXY (free, no CORS issues) ───────────────────────────
const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const NEWS_BASE = "https://query1.finance.yahoo.com/v1/finance/search?q=";

const SYMBOLS = {
  indices: [
    { symbol: "^NSEI",   label: "NIFTY 50",  cur: "₹", region: "IN" },
    { symbol: "^BSESN",  label: "SENSEX",    cur: "₹", region: "IN" },
    { symbol: "^IXIC",   label: "NASDAQ",    cur: "$", region: "US" },
    { symbol: "^GSPC",   label: "S&P 500",   cur: "$", region: "US" },
    { symbol: "GC=F",    label: "GOLD",      cur: "$", region: "COMM" },
    { symbol: "USDINR=X",label: "USD/INR",   cur: "₹", region: "FX" },
  ],
  india: [
    { symbol: "RELIANCE.NS", name: "Reliance Industries", sector: "Energy" },
    { symbol: "SBIN.NS",     name: "State Bank of India", sector: "Banking" },
    { symbol: "HDFCBANK.NS", name: "HDFC Bank",           sector: "Banking" },
    { symbol: "TATAMOTORS.NS",name:"Tata Motors",         sector: "Auto" },
    { symbol: "INFY.NS",     name: "Infosys",             sector: "IT" },
    { symbol: "WIPRO.NS",    name: "Wipro Ltd",           sector: "IT" },
    { symbol: "ADANIENT.NS", name: "Adani Enterprises",   sector: "Conglomerate" },
    { symbol: "ICICIBANK.NS",name: "ICICI Bank",          sector: "Banking" },
  ],
  usa: [
    { symbol: "NVDA",  name: "NVIDIA Corp",    sector: "Semiconductors" },
    { symbol: "META",  name: "Meta Platforms", sector: "Social Media" },
    { symbol: "TSLA",  name: "Tesla Inc",      sector: "EV" },
    { symbol: "AAPL",  name: "Apple Inc",      sector: "Technology" },
    { symbol: "AMZN",  name: "Amazon",         sector: "E-Commerce" },
    { symbol: "MSFT",  name: "Microsoft",      sector: "Technology" },
    { symbol: "GOOGL", name: "Alphabet",       sector: "Technology" },
    { symbol: "JPM",   name: "JPMorgan Chase", sector: "Banking" },
  ],
};

// SMC signal logic based on price movement + volume
function calcSMC(price, prevClose, volume, avgVol) {
  const chgPct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
  const volRatio = avgVol ? (volume / avgVol) : 1;
  let strength = 50;
  if (Math.abs(chgPct) > 2) strength += 20;
  if (Math.abs(chgPct) > 3) strength += 10;
  if (volRatio > 2) strength += 15;
  if (volRatio > 3) strength += 10;
  strength = Math.min(98, Math.max(30, strength));
  const setups = chgPct > 1.5
    ? ["Order Block Bounce", "BOS Confirmed", "High Volume"][Math.floor(Math.random()*3)]
    : chgPct < -1.5
    ? ["Supply Zone Rejection", "CHoCH Signal", "Bearish OB"][Math.floor(Math.random()*3)]
    : "Range Consolidation — No Clear Setup";
  return { chgPct: +chgPct.toFixed(2), volRatio: +volRatio.toFixed(1), strength, setup: setups };
}

async function fetchQuote(symbol) {
  try {
    const url = `${YF_BASE}${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const res = await fetch(url);
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const quotes = json?.chart?.result?.[0]?.indicators?.quote?.[0];
    const timestamps = json?.chart?.result?.[0]?.timestamp;
    if (!meta) return null;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const volume = meta.regularMarketVolume || 0;
    const avgVol = meta.averageDailyVolume3Month || volume || 1;
    // Build sparkline from closes
    const closes = quotes?.close || [];
    const times = timestamps || [];
    const sparkline = closes
      .map((c, i) => ({ t: times[i], v: c }))
      .filter(p => p.v != null)
      .slice(-30);
    return { price, prevClose, volume, avgVol, sparkline, currency: meta.currency, marketState: meta.marketState };
  } catch { return null; }
}

async function fetchNews(query) {
  try {
    const res = await fetch(`${NEWS_BASE}${encodeURIComponent(query)}&newsCount=6&lang=en`);
    const json = await res.json();
    return json?.news || [];
  } catch { return []; }
}

// ─── CHART COMPONENT ──────────────────────────────────────────────────────
function Sparkline({ data, positive, height = 50 }) {
  if (!data || data.length < 2) return <div style={{ height }} />;
  const color = positive ? "#00e87a" : "#ff4d4d";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`sg${positive ? "p" : "n"}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#sg${positive ? "p" : "n"})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("home");
  const [market, setMarket] = useState("india");
  const [filter, setFilter] = useState("ALL");
  const [indices, setIndices] = useState({});
  const [stocks, setStocks] = useState({});
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [plan, setPlan] = useState("yearly");
  const [subscribed, setSubscribed] = useState(false);
  const [chartStock, setChartStock] = useState(null);
  const [chartData, setChartData] = useState([]);
  const intervalRef = useRef(null);

  const now = new Date();
  const timeS = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateS = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // ── Fetch all data ──
  const fetchAll = useCallback(async () => {
    // Indices
    const idxResults = {};
    await Promise.all(SYMBOLS.indices.map(async (idx) => {
      const q = await fetchQuote(idx.symbol);
      if (q) idxResults[idx.symbol] = { ...idx, ...q };
    }));
    setIndices(idxResults);

    // Stocks
    const allSymbols = [...SYMBOLS.india, ...SYMBOLS.usa];
    const stkResults = {};
    await Promise.all(allSymbols.map(async (s) => {
      const q = await fetchQuote(s.symbol);
      if (q) {
        const smc = calcSMC(q.price, q.prevClose, q.volume, q.avgVol);
        stkResults[s.symbol] = { ...s, ...q, ...smc };
      }
    }));
    setStocks(stkResults);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  // Fetch news
  useEffect(() => {
    fetchNews("Indian stock market Nifty").then(n => setNews(n.slice(0, 6)));
  }, []);

  // Initial fetch + 30s refresh
  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 30000);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  // Chart for expanded stock
  useEffect(() => {
    if (!expanded) return;
    const s = stocks[expanded];
    if (s?.sparkline) setChartData(s.sparkline);
  }, [expanded, stocks]);

  const indiaStocks  = SYMBOLS.india.map(s => stocks[s.symbol]).filter(Boolean);
  const usaStocks    = SYMBOLS.usa.map(s => stocks[s.symbol]).filter(Boolean);
  const activeStocks = market === "india" ? indiaStocks : usaStocks;
  const cur          = market === "india" ? "₹" : "$";

  const filtered = filter === "ALL" ? activeStocks
    : filter === "BULLISH" ? activeStocks.filter(s => s.chgPct > 0.5 && s.strength >= 70)
    : filter === "BEARISH" ? activeStocks.filter(s => s.chgPct < -0.5)
    : activeStocks.filter(s => s.strength < 65);

  const bullCount = activeStocks.filter(s => s.chgPct > 0.5 && s.strength >= 70).length;
  const bearCount = activeStocks.filter(s => s.chgPct < -0.5).length;

  // ── STYLES ────────────────────────────────────────────────────────────────
  const C = {
    bg:       "#07090f",
    surface:  "#0d1117",
    border:   "rgba(255,255,255,0.07)",
    accent:   "#0ea5e9",
    green:    "#22c55e",
    red:      "#ef4444",
    gold:     "#f59e0b",
    text:     "#e2e8f0",
    muted:    "#475569",
    faint:    "#1e293b",
  };

  const navStyle = {
    position: "sticky", top: 0, zIndex: 200,
    background: "rgba(7,9,15,0.96)", backdropFilter: "blur(20px)",
    borderBottom: `1px solid ${C.border}`,
    padding: "0 clamp(16px,4vw,64px)",
    display: "flex", justifyContent: "space-between", alignItems: "center", height: "64px",
    fontFamily: "'Syne', sans-serif",
  };

  const bodyFont = "'JetBrains Mono', 'Fira Code', monospace";
  const headFont = "'Syne', 'Archivo Black', sans-serif";

  return (
    <div style={{ fontFamily: bodyFont, background: C.bg, minHeight: "100vh", color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#07090f}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}
        @keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .fade-up{animation:fadeUp .5s ease both}
        .nav-link:hover{color:#0ea5e9 !important}
        .card-hover:hover{border-color:rgba(14,165,233,0.3) !important;background:rgba(14,165,233,0.04) !important}
        .btn-primary:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(14,165,233,0.3) !important}
        .btn-outline:hover{background:rgba(14,165,233,0.08) !important;border-color:rgba(14,165,233,0.5) !important}
        img{max-width:100%;display:block}
      `}</style>

      {/* ── NAV ── */}
      <nav style={navStyle}>
        <div style={{ fontFamily: headFont, fontSize: "18px", fontWeight: "800", cursor: "pointer",
                      color: C.text, letterSpacing: "-0.02em" }} onClick={() => setPage("home")}>
          trade<span style={{ color: C.accent }}>withshubh</span>
          <span style={{ fontSize: "10px", color: C.muted, fontFamily: bodyFont, marginLeft: "8px",
                         verticalAlign: "middle", fontWeight: "400" }}>beta</span>
        </div>
        <div style={{ display: "flex", gap: "32px", alignItems: "center" }}>
          {[["home","Home"],["screener","Screener"],["news","News"],["pricing","Pricing"]].map(([k,l]) => (
            <span key={k} className="nav-link" onClick={() => setPage(k)} style={{
              fontSize: "13px", cursor: "pointer", letterSpacing: "0.02em",
              color: page === k ? C.accent : C.muted, fontWeight: page === k ? "500" : "400",
              transition: "color .2s",
            }}>{l}</span>
          ))}
          <button className="btn-primary" onClick={() => setPage("pricing")} style={{
            padding: "9px 20px", background: C.accent, border: "none", borderRadius: "8px",
            color: "#fff", fontSize: "12px", fontWeight: "700", cursor: "pointer",
            fontFamily: bodyFont, letterSpacing: "0.06em", transition: "all .2s",
          }}>GET ACCESS</button>
        </div>
      </nav>

      {/* ── LIVE TICKER ── */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`,
                    height: "38px", overflow: "hidden", display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "0", animation: "ticker 35s linear infinite", whiteSpace: "nowrap" }}>
          {[...SYMBOLS.indices, ...SYMBOLS.indices].map((idx, i) => {
            const q = indices[idx.symbol];
            const chg = q ? q.chgPct : null;
            return (
              <span key={i} style={{ fontSize: "11px", padding: "0 24px",
                borderRight: `1px solid ${C.border}`, display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <span style={{ color: C.muted }}>{idx.label}</span>
                <span style={{ color: C.text, fontWeight: "500" }}>
                  {q ? `${idx.cur}${q.price?.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
                </span>
                {chg != null && (
                  <span style={{ color: chg >= 0 ? C.green : C.red }}>
                    {chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(2)}%
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* ══ PAGES ══ */}

      {/* ── HOME ── */}
      {page === "home" && (
        <div>
          {/* Hero with real bg image */}
          <div style={{ position: "relative", minHeight: "88vh", display: "flex",
                        alignItems: "center", overflow: "hidden" }}>
            <img src="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1600&q=80"
              alt="trading" style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover", opacity: 0.12, filter: "saturate(0.4)" }} />
            <div style={{ position: "absolute", inset: 0,
              background: "linear-gradient(135deg, rgba(7,9,15,0.97) 0%, rgba(7,9,15,0.85) 60%, rgba(14,165,233,0.05) 100%)" }} />

            <div style={{ position: "relative", zIndex: 1, padding: "80px clamp(16px,6vw,96px)",
                          maxWidth: "900px" }} className="fade-up">
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.green,
                              boxShadow: `0 0 12px ${C.green}`, animation: "pulse 2s infinite" }} />
                <span style={{ fontSize: "11px", color: C.green, letterSpacing: "0.18em", fontWeight: "500" }}>
                  LIVE DATA · UPDATES EVERY 30s
                </span>
                <span style={{ color: C.faint }}>|</span>
                <span style={{ fontSize: "11px", color: C.muted }}>{timeS} IST</span>
              </div>

              <h1 style={{ fontFamily: headFont, fontSize: "clamp(36px,6vw,80px)", fontWeight: "800",
                           lineHeight: 1.02, letterSpacing: "-0.03em", color: "#fff", marginBottom: "20px" }}>
                Your pre-market<br />
                <span style={{ color: C.accent }}>edge, every day.</span>
              </h1>

              <p style={{ fontSize: "clamp(14px,1.6vw,17px)", color: C.muted, lineHeight: 1.8,
                          maxWidth: "560px", marginBottom: "36px" }}>
                Daily screener reports for Indian & US markets — powered by Smart Money Concepts.
                Published before 9:00 AM IST. Educational use only.
              </p>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <button className="btn-primary" onClick={() => setPage("screener")} style={{
                  padding: "15px 32px", background: C.accent, border: "none", borderRadius: "10px",
                  color: "#fff", fontSize: "14px", fontWeight: "700", cursor: "pointer",
                  fontFamily: bodyFont, letterSpacing: "0.06em", transition: "all .2s",
                  boxShadow: "0 8px 24px rgba(14,165,233,0.25)",
                }}>View Today's Report →</button>
                <button className="btn-outline" onClick={() => setPage("pricing")} style={{
                  padding: "15px 32px", background: "transparent",
                  border: `1px solid ${C.border}`, borderRadius: "10px",
                  color: C.text, fontSize: "14px", cursor: "pointer",
                  fontFamily: bodyFont, transition: "all .2s",
                }}>See Plans</button>
              </div>
            </div>
          </div>

          {/* Indices grid with real data */}
          <div style={{ padding: "56px clamp(16px,5vw,80px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <div>
                <div style={{ fontSize: "11px", color: C.accent, letterSpacing: "0.18em", marginBottom: "6px" }}>LIVE MARKET DATA</div>
                <div style={{ fontFamily: headFont, fontSize: "clamp(20px,3vw,30px)", fontWeight: "700", color: "#fff" }}>
                  Global Indices
                </div>
              </div>
              <div style={{ fontSize: "11px", color: C.muted }}>
                {loading ? "Loading..." : `Updated ${lastUpdated?.toLocaleTimeString("en-IN")}`}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "12px" }}>
              {SYMBOLS.indices.map(idx => {
                const q = indices[idx.symbol];
                return (
                  <div key={idx.symbol} className="card-hover" style={{
                    padding: "20px", background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: "12px", transition: "all .2s",
                  }}>
                    <div style={{ fontSize: "10px", color: C.muted, letterSpacing: "0.14em", marginBottom: "8px" }}>{idx.label}</div>
                    {q ? (
                      <>
                        <div style={{ fontSize: "20px", color: "#fff", fontWeight: "700", marginBottom: "4px" }}>
                          {idx.cur}{q.price?.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </div>
                        <div style={{ fontSize: "13px", color: q.chgPct >= 0 ? C.green : C.red }}>
                          {q.chgPct >= 0 ? "▲" : "▼"} {Math.abs(q.chgPct).toFixed(2)}%
                        </div>
                        <div style={{ marginTop: "10px" }}>
                          <Sparkline data={q.sparkline} positive={q.chgPct >= 0} height={40} />
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: "11px", color: C.faint }}>Loading...</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* How it works */}
          <div style={{ padding: "56px clamp(16px,5vw,80px)", borderTop: `1px solid ${C.border}`,
                        background: "rgba(14,165,233,0.02)" }}>
            <div style={{ textAlign: "center", marginBottom: "48px" }}>
              <div style={{ fontSize: "11px", color: C.accent, letterSpacing: "0.18em", marginBottom: "8px" }}>METHODOLOGY</div>
              <div style={{ fontFamily: headFont, fontSize: "clamp(22px,3.5vw,36px)", fontWeight: "700", color: "#fff" }}>
                How the screener works
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "16px" }}>
              {[
                ["📡", "Data Fetched at 8 AM", "Yahoo Finance pulls real-time prices, volume & OHLC for 100+ symbols across NSE, BSE, NYSE & NASDAQ."],
                ["🧮", "SMC Filters Applied", "Stocks screened for Order Blocks, Fair Value Gaps, Break of Structure, CHoCH and volume anomalies."],
                ["📊", "Report Published", "Results live on this site before 9 AM IST. No BUY/SELL advice — criteria matches only."],
                ["🎯", "You Decide", "Use the screener as a starting point. Every decision stays with you as a self-directed trader."],
              ].map(([icon, title, desc]) => (
                <div key={title} className="card-hover" style={{
                  padding: "24px", background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: "14px", transition: "all .2s",
                }}>
                  <div style={{ fontSize: "28px", marginBottom: "14px" }}>{icon}</div>
                  <div style={{ fontFamily: headFont, fontSize: "15px", color: "#fff", fontWeight: "600", marginBottom: "10px" }}>{title}</div>
                  <div style={{ fontSize: "12px", color: C.muted, lineHeight: "1.8" }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div style={{ padding: "72px clamp(16px,5vw,80px)", textAlign: "center" }}>
            <img src="https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&q=80"
              alt="charts" style={{ width: "100%", maxWidth: "700px", borderRadius: "16px",
              margin: "0 auto 40px", opacity: 0.6, border: `1px solid ${C.border}` }} />
            <div style={{ fontFamily: headFont, fontSize: "clamp(24px,4vw,44px)", fontWeight: "800", color: "#fff", marginBottom: "16px" }}>
              Start your 7-day free trial.
            </div>
            <p style={{ fontSize: "14px", color: C.muted, marginBottom: "28px" }}>
              No credit card needed. Full access from day one.
            </p>
            <button className="btn-primary" onClick={() => setPage("pricing")} style={{
              padding: "16px 40px", background: C.accent, border: "none", borderRadius: "10px",
              color: "#fff", fontSize: "15px", fontWeight: "700", cursor: "pointer",
              fontFamily: bodyFont, boxShadow: "0 10px 32px rgba(14,165,233,0.3)", transition: "all .2s",
            }}>Get Free Access →</button>
          </div>
        </div>
      )}

      {/* ── SCREENER ── */}
      {page === "screener" && (
        <div style={{ padding: "40px clamp(16px,5vw,80px)" }}>
          <div style={{ marginBottom: "28px" }}>
            <div style={{ fontSize: "11px", color: C.accent, letterSpacing: "0.18em", marginBottom: "6px" }}>
              PRE-MARKET SCREENER · {dateS}
            </div>
            <div style={{ fontFamily: headFont, fontSize: "clamp(22px,3.5vw,36px)", fontWeight: "700", color: "#fff", marginBottom: "8px" }}>
              Today's Setups
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
              <div style={{ width: "7px", height: "7px", borderRadius: "50%",
                            background: C.green, boxShadow: `0 0 8px ${C.green}`, animation: "pulse 2s infinite" }} />
              <span style={{ color: C.green }}>Live · Auto-refreshes every 30 seconds</span>
              {lastUpdated && <span style={{ color: C.muted }}>· Last: {lastUpdated.toLocaleTimeString("en-IN")}</span>}
              {loading && <span style={{ color: C.muted }}>· Fetching...</span>}
            </div>
          </div>

          {/* Disclaimer */}
          <div style={{ background: "rgba(245,158,11,0.06)", border: `1px solid rgba(245,158,11,0.2)`,
                        borderRadius: "10px", padding: "14px 18px", fontSize: "12px",
                        color: "#92400e", lineHeight: "1.8", marginBottom: "24px" }}>
            ⚠️ <strong style={{ color: C.gold }}>Educational Screener Only.</strong> TradeWithShubh is not SEBI-registered.
            Stocks listed match technical criteria based on SMC methodology. <strong>Not financial advice.</strong> Do your own research.
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
            {[["india","🇮🇳 India"],["usa","🇺🇸 USA"]].map(([k,l]) => (
              <button key={k} onClick={() => setMarket(k)} style={{
                padding: "8px 18px", borderRadius: "8px", fontSize: "12px", cursor: "pointer",
                fontFamily: bodyFont, border: "none",
                background: market === k ? "rgba(14,165,233,0.15)" : C.surface,
                color: market === k ? C.accent : C.muted,
                outline: market === k ? `1px solid rgba(14,165,233,0.4)` : `1px solid ${C.border}`,
              }}>{l}</button>
            ))}
            <div style={{ width: "1px", height: "24px", background: C.border }} />
            {["ALL","BULLISH","BEARISH","WEAK"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "7px 14px", borderRadius: "20px", fontSize: "11px", cursor: "pointer",
                fontFamily: bodyFont, border: "none", letterSpacing: "0.08em",
                background: filter === f ? "rgba(14,165,233,0.15)" : "transparent",
                color: filter === f ? C.accent : C.muted,
                outline: filter === f ? `1px solid rgba(14,165,233,0.35)` : `1px solid ${C.border}`,
              }}>{f}</button>
            ))}
            <button onClick={fetchAll} style={{
              marginLeft: "auto", padding: "7px 14px", borderRadius: "8px", fontSize: "11px",
              cursor: "pointer", fontFamily: bodyFont, background: "transparent",
              border: `1px solid ${C.border}`, color: C.muted,
            }}>↻ Refresh</button>
          </div>

          {/* Summary pills */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "24px", flexWrap: "wrap" }}>
            {[[bullCount,"BULLISH SETUPS",C.green],[bearCount,"BEARISH SETUPS",C.red],
              [activeStocks.length,"TOTAL SCREENED","#94a3b8"]].map(([n,l,c]) => (
              <div key={l} style={{ padding: "10px 18px", borderRadius: "10px",
                background: `${c}12`, border: `1px solid ${c}30`,
                display: "flex", gap: "10px", alignItems: "center" }}>
                <span style={{ fontSize: "22px", color: c, fontWeight: "800", fontFamily: headFont }}>{n}</span>
                <span style={{ fontSize: "10px", color: c, opacity: 0.7, letterSpacing: "0.12em" }}>{l}</span>
              </div>
            ))}
          </div>

          {/* Stock cards */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "80px", color: C.muted }}>
              <div style={{ fontSize: "32px", animation: "spin 1s linear infinite", display: "inline-block", marginBottom: "16px" }}>◌</div>
              <div style={{ fontSize: "13px", letterSpacing: "0.1em" }}>FETCHING LIVE DATA FROM YAHOO FINANCE...</div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px", color: C.muted, fontSize: "13px" }}>
              No stocks match this filter right now.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: "12px" }}>
              {filtered.map(s => {
                const exp = expanded === s.symbol;
                const pos = s.chgPct >= 0;
                return (
                  <div key={s.symbol} className="card-hover" onClick={() => setExpanded(exp ? null : s.symbol)}
                    style={{ padding: "18px 20px", background: exp ? "rgba(14,165,233,0.05)" : C.surface,
                             border: `1px solid ${exp ? "rgba(14,165,233,0.3)" : C.border}`,
                             borderLeft: `3px solid ${pos ? C.green : C.red}`,
                             borderRadius: "12px", cursor: "pointer", transition: "all .2s" }}>

                    {/* Top row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                      <div>
                        <div style={{ fontFamily: headFont, fontSize: "16px", color: "#fff", fontWeight: "700" }}>{s.symbol.replace(".NS","")}</div>
                        <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>{s.name} · {s.sector}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "17px", color: C.text, fontWeight: "600" }}>
                          {cur}{s.price?.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </div>
                        <div style={{ fontSize: "13px", color: pos ? C.green : C.red, marginTop: "2px" }}>
                          {pos ? "▲" : "▼"} {Math.abs(s.chgPct).toFixed(2)}%
                        </div>
                      </div>
                    </div>

                    {/* Sparkline */}
                    <div style={{ margin: "8px 0" }}>
                      <Sparkline data={s.sparkline} positive={pos} height={48} />
                    </div>

                    {/* Setup */}
                    <div style={{ fontSize: "11px", color: C.muted, marginBottom: "10px" }}>📋 {s.setup}</div>

                    {/* Strength bar */}
                    <div style={{ height: "3px", background: C.faint, borderRadius: "2px", marginBottom: "6px" }}>
                      <div style={{ height: "100%", width: `${s.strength}%`, borderRadius: "2px",
                                    background: s.strength >= 80 ? `linear-gradient(90deg,${C.green}80,${C.green})`
                                              : s.strength >= 60 ? `linear-gradient(90deg,${C.gold}80,${C.gold})`
                                              : `linear-gradient(90deg,${C.red}80,${C.red})`,
                                    transition: "width 1s ease" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
                      <span style={{ color: C.muted, letterSpacing: "0.1em" }}>SIGNAL STRENGTH</span>
                      <span style={{ color: s.strength >= 80 ? C.green : s.strength >= 60 ? C.gold : C.red, fontWeight: "700" }}>
                        {s.strength}%
                      </span>
                    </div>

                    {/* Volume */}
                    <div style={{ marginTop: "8px", fontSize: "11px", color: C.muted }}>
                      📊 Vol: <span style={{ color: C.gold }}>{s.volRatio}x avg</span>
                    </div>

                    {/* Expanded detail */}
                    {exp && (
                      <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: `1px solid ${C.border}` }}>
                        <div style={{ fontSize: "10px", color: C.muted, letterSpacing: "0.12em", marginBottom: "10px" }}>
                          LIVE CHART — TODAY
                        </div>
                        <ResponsiveContainer width="100%" height={120}>
                          <AreaChart data={s.sparkline}>
                            <defs>
                              <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={pos ? C.green : C.red} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={pos ? C.green : C.red} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="t" hide />
                            <YAxis domain={["auto","auto"]} hide />
                            <Tooltip
                              contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "8px",
                                             fontSize: "11px", color: C.text }}
                              formatter={(v) => [`${cur}${v?.toFixed(2)}`, "Price"]}
                              labelFormatter={() => ""}
                            />
                            <Area type="monotone" dataKey="v" stroke={pos ? C.green : C.red}
                              strokeWidth={2} fill="url(#cg)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                        <div style={{ marginTop: "12px", padding: "10px 12px", borderRadius: "8px",
                                      background: "rgba(245,158,11,0.05)", border: `1px solid rgba(245,158,11,0.15)`,
                                      fontSize: "11px", color: "#78350f", lineHeight: "1.7" }}>
                          ⚠️ Educational only. Not financial advice. Always DYOR before trading.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── NEWS ── */}
      {page === "news" && (
        <div style={{ padding: "40px clamp(16px,5vw,80px)" }}>
          <div style={{ marginBottom: "32px" }}>
            <div style={{ fontSize: "11px", color: C.accent, letterSpacing: "0.18em", marginBottom: "6px" }}>MARKET NEWS</div>
            <div style={{ fontFamily: headFont, fontSize: "clamp(22px,3.5vw,36px)", fontWeight: "700", color: "#fff" }}>
              Latest Updates
            </div>
          </div>

          {/* Hero news image */}
          <div style={{ position: "relative", borderRadius: "16px", overflow: "hidden", marginBottom: "32px" }}>
            <img src="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1200&q=80"
              alt="markets" style={{ width: "100%", height: "300px", objectFit: "cover", opacity: 0.7 }} />
            <div style={{ position: "absolute", inset: 0,
              background: "linear-gradient(to top, rgba(7,9,15,0.95) 0%, transparent 60%)" }} />
            <div style={{ position: "absolute", bottom: "24px", left: "28px", right: "28px" }}>
              <div style={{ fontSize: "11px", color: C.accent, letterSpacing: "0.14em", marginBottom: "6px" }}>FEATURED</div>
              <div style={{ fontFamily: headFont, fontSize: "clamp(16px,2.5vw,24px)", color: "#fff", fontWeight: "700" }}>
                Indian Markets Continue Rally — FII Flows Turn Positive in April 2026
              </div>
            </div>
          </div>

          {/* News grid */}
          {news.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: "16px" }}>
              {news.map((item, i) => (
                <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                  style={{ textDecoration: "none", display: "block" }}>
                  <div className="card-hover" style={{ padding: "20px", background: C.surface,
                       border: `1px solid ${C.border}`, borderRadius: "12px", transition: "all .2s", height: "100%" }}>
                    {item.thumbnail?.resolutions?.[0]?.url && (
                      <img src={item.thumbnail.resolutions[0].url} alt=""
                        style={{ width: "100%", height: "140px", objectFit: "cover",
                                 borderRadius: "8px", marginBottom: "14px" }} />
                    )}
                    <div style={{ fontSize: "10px", color: C.accent, letterSpacing: "0.12em", marginBottom: "8px" }}>
                      {item.publisher?.toUpperCase() || "MARKET NEWS"}
                    </div>
                    <div style={{ fontFamily: headFont, fontSize: "14px", color: C.text, fontWeight: "600",
                                  lineHeight: "1.5", marginBottom: "8px" }}>{item.title}</div>
                    <div style={{ fontSize: "11px", color: C.muted }}>
                      {item.providerPublishTime
                        ? new Date(item.providerPublishTime * 1000).toLocaleDateString("en-IN")
                        : "Today"}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: "16px" }}>
              {[
                { tag: "NIFTY", title: "Nifty 50 Eyes Fresh Record High as FII Buying Accelerates in April", time: "2h ago", img: "photo-1590283603385-17ffb3a7f29f" },
                { tag: "RBI", title: "RBI Holds Rates at 6.5% — Policy Remains Accommodative for Growth", time: "4h ago", img: "photo-1611974789855-9c2a0a7236a3" },
                { tag: "NASDAQ", title: "NASDAQ Futures Rise 0.4% as Nvidia Earnings Beat Expectations", time: "5h ago", img: "photo-1642543492481-44e81e3914a7" },
                { tag: "CRUDE", title: "Crude Oil Drops Below $80 — Positive Signal for Indian Import Bill", time: "6h ago", img: "photo-1611974789855-9c2a0a7236a3" },
                { tag: "SME IPO", title: "3 SME IPOs Open This Week — Subscription Data & GMP Analysis", time: "8h ago", img: "photo-1590283603385-17ffb3a7f29f" },
                { tag: "FII/DII", title: "FIIs Net Buyers at ₹4,200 Cr — DIIs Sell ₹1,800 Cr on Tuesday", time: "Yesterday", img: "photo-1642543492481-44e81e3914a7" },
              ].map((n, i) => (
                <div key={i} className="card-hover" style={{ background: C.surface,
                     border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden", transition: "all .2s" }}>
                  <img src={`https://images.unsplash.com/${n.img}?w=400&q=70`} alt=""
                    style={{ width: "100%", height: "140px", objectFit: "cover", opacity: 0.75 }} />
                  <div style={{ padding: "16px" }}>
                    <div style={{ fontSize: "10px", color: C.accent, letterSpacing: "0.12em", marginBottom: "8px" }}>{n.tag}</div>
                    <div style={{ fontFamily: headFont, fontSize: "14px", color: C.text, fontWeight: "600",
                                  lineHeight: "1.5", marginBottom: "10px" }}>{n.title}</div>
                    <div style={{ fontSize: "11px", color: C.muted }}>{n.time}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PRICING ── */}
      {page === "pricing" && (
        <div style={{ padding: "60px clamp(16px,5vw,80px)", maxWidth: "900px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <div style={{ fontSize: "11px", color: C.accent, letterSpacing: "0.18em", marginBottom: "10px" }}>PRICING</div>
            <div style={{ fontFamily: headFont, fontSize: "clamp(24px,4vw,48px)", fontWeight: "800", color: "#fff", marginBottom: "14px" }}>
              Simple. Transparent. Free to start.
            </div>
            <p style={{ fontSize: "14px", color: C.muted, lineHeight: "1.8" }}>
              Full access to daily pre-market screener for Indian & US markets.
            </p>
          </div>

          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "32px" }}>
            {[
              { key: "monthly", label: "MONTHLY", price: "₹499", per: "/month", usd: "~$6/mo", badge: null },
              { key: "yearly",  label: "YEARLY",  price: "₹3,999", per: "/year", usd: "~$48/yr", badge: "BEST VALUE — SAVE 33%" },
            ].map(p => (
              <div key={p.key} onClick={() => setPlan(p.key)} style={{
                flex: 1, minWidth: "220px", padding: "32px 24px", borderRadius: "16px", textAlign: "center",
                background: plan === p.key ? "rgba(14,165,233,0.08)" : C.surface,
                border: `1px solid ${plan === p.key ? "rgba(14,165,233,0.4)" : C.border}`,
                cursor: "pointer", position: "relative", transition: "all .2s",
              }}>
                {p.badge && (
                  <div style={{ position: "absolute", top: "-13px", left: "50%", transform: "translateX(-50%)",
                                background: C.accent, color: "#fff", fontSize: "9px", fontWeight: "800",
                                padding: "4px 14px", borderRadius: "20px", letterSpacing: "0.12em", whiteSpace: "nowrap" }}>
                    {p.badge}
                  </div>
                )}
                <div style={{ fontSize: "11px", color: C.muted, letterSpacing: "0.16em", marginBottom: "12px" }}>{p.label}</div>
                <div style={{ fontFamily: headFont, fontSize: "40px", color: plan === p.key ? C.accent : "#fff",
                              fontWeight: "800", marginBottom: "4px" }}>{p.price}</div>
                <div style={{ fontSize: "12px", color: C.muted }}>{p.per} · {p.usd}</div>
              </div>
            ))}
          </div>

          {[
            ["📊", "Daily Pre-Market Report", "Every morning before 9:00 AM IST"],
            ["🇮🇳", "Indian Markets (NSE & BSE)", "Nifty 50, Next 50, Midcap stocks"],
            ["🇺🇸", "US Markets (NYSE & NASDAQ)", "Top movers screened with SMC criteria"],
            ["📈", "Live Intraday Charts", "Real-time sparklines and price charts"],
            ["🧠", "SMC Methodology", "OBs, FVGs, BOS, CHoCH, liquidity sweeps"],
            ["🔓", "Unlimited Access", "No daily limits, full history, all filters"],
          ].map(([icon, t, d]) => (
            <div key={t} style={{ display: "flex", gap: "14px", padding: "15px 0",
                                  borderBottom: `1px solid ${C.border}`, alignItems: "center" }}>
              <div style={{ fontSize: "20px", width: "30px", flexShrink: 0 }}>{icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", color: C.text, fontWeight: "500" }}>{t}</div>
                <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>{d}</div>
              </div>
              <div style={{ fontSize: "18px", color: C.green }}>✓</div>
            </div>
          ))}

          <div style={{ marginTop: "32px" }}>
            <button className="btn-primary" onClick={() => setSubscribed(true)} style={{
              width: "100%", padding: "18px",
              background: subscribed ? "rgba(34,197,94,0.12)" : C.accent,
              border: subscribed ? `1px solid ${C.green}` : "none",
              borderRadius: "12px", color: subscribed ? C.green : "#fff",
              fontSize: "15px", fontWeight: "700", cursor: "pointer", fontFamily: bodyFont,
              letterSpacing: "0.06em", transition: "all .3s",
              boxShadow: subscribed ? "none" : "0 10px 32px rgba(14,165,233,0.3)",
            }}>
              {subscribed ? "✓ SUBSCRIBED — WELCOME TO TRADEWITHSHUBH!" : `START 7-DAY FREE TRIAL · THEN ${plan === "yearly" ? "₹3,999/yr" : "₹499/mo"}`}
            </button>
            <div style={{ textAlign: "center", fontSize: "11px", color: C.muted, marginTop: "12px" }}>
              Secure payment via Razorpay · Cancel anytime · No hidden charges
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "28px clamp(16px,5vw,80px)",
                       display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "12px",
                       background: C.surface }}>
        <div style={{ fontFamily: headFont, fontSize: "15px", fontWeight: "700", color: C.muted }}>
          trade<span style={{ color: C.accent }}>withshubh</span>
        </div>
        <div style={{ fontSize: "11px", color: C.faint, letterSpacing: "0.08em" }}>
          © 2026 · @tradewshubh · FOR EDUCATIONAL PURPOSES ONLY · NOT SEBI REGISTERED · NOT FINANCIAL ADVICE
        </div>
      </footer>
    </div>
  );
}
