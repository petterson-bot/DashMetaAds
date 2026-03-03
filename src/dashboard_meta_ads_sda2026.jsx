import { useState, useEffect, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const ACCOUNTS = [
  { id: "act_629328937757745", label: "Conta 03", color: "#06B6D4" },
  { id: "act_377480853270622", label: "Conta 04", color: "#D4A843" },
];

const META_TOKEN = import.meta.env.VITE_META_TOKEN;
const META_BASE = "https://graph.facebook.com/v19.0";
const SHEETS_ID = "14wF4J0lYLywXDAcpCHiV60GdvEM_BLkNf1CWCWrRfXM";
const SHEETS_URL = `https://docs.google.com/spreadsheets/d/${SHEETS_ID}/export?format=csv&gid=0`;

async function metaGet(endpoint, params = {}) {
  const url = new URL(`${META_BASE}/${endpoint}`);
  url.searchParams.set("access_token", META_TOKEN);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Meta API error: ${res.status}`);
  return res.json();
}

async function fetchSheetData() {
  try {
    const res = await fetch(SHEETS_URL);
    const text = await res.text();
    const rows = text.split("\n").map(r => {
      const cols = [];
      let cur = "", inQ = false;
      for (let i = 0; i < r.length; i++) {
        if (r[i] === '"') inQ = !inQ;
        else if (r[i] === ',' && !inQ) { cols.push(cur.trim()); cur = ""; }
        else cur += r[i];
      }
      cols.push(cur.trim());
      return cols;
    });
    // Skip header row
    const data = rows.slice(1).filter(r => r.length > 10);
    // Build map: campaign -> { revenue, qty }
    const map = {};
    data.forEach(row => {
      const produto = (row[9] || "").toLowerCase(); // Col J (index 9)
      if (produto.includes("congelado")) return; // skip congelados
      const campanha = (row[17] || "").trim(); // Col R (index 17)
      const valorStr = (row[11] || "").replace(/[R$\s.]/g, "").replace(",", "."); // Col L (index 11)
      const qtyStr = (row[10] || "").replace(/[^\d]/g, ""); // Col K (index 10)
      const valor = parseFloat(valorStr) || 0;
      const qty = parseInt(qtyStr) || 0;
      if (!campanha) return;
      if (!map[campanha]) map[campanha] = { revenue: 0, qty: 0 };
      map[campanha].revenue += valor;
      map[campanha].qty += qty;
    });
    return map;
  } catch (e) {
    console.error("Sheets error:", e);
    return {};
  }
}

function parseActions(actions, type) {
  if (!actions) return 0;
  const a = actions.find(x => x.action_type === type);
  return a ? parseInt(a.value) : 0;
}
function parseCPA(costPerAction, type) {
  if (!costPerAction) return 0;
  const a = costPerAction.find(x => x.action_type === type);
  return a ? parseFloat(a.value) : 0;
}
function fmt(n) {
  if (n === null || n === undefined) return "—";
  if (typeof n === "string") n = parseFloat(n);
  if (isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n) || n === 0) return "R$ —";
  return `R$ ${parseFloat(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(n) {
  if (!n || isNaN(n)) return "—";
  return `${parseFloat(n).toFixed(2)}%`;
}
function fmtRoas(n) {
  if (!n || isNaN(n) || n === 0) return "—";
  return `${parseFloat(n).toFixed(2)}x`;
}

function KPI({ label, value, sub, color = "#D4A843", icon }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${color}22`, borderRadius: 14, padding: "18px 16px", textAlign: "center", transition: "all 0.25s", cursor: "default", position: "relative", overflow: "hidden" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color + "66"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = color + "22"; e.currentTarget.style.transform = "translateY(0)"; }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: 0.4 }} />
      <div style={{ fontSize: 10, color: "#8888A0", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#666680", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Tab({ label, active, onClick, color }) {
  return (
    <button onClick={onClick} style={{ padding: "10px 24px", background: active ? color + "18" : "transparent", border: `1px solid ${active ? color : "rgba(255,255,255,0.08)"}`, borderRadius: 10, color: active ? color : "#8888A0", fontWeight: active ? 700 : 400, fontSize: 13, cursor: "pointer", transition: "all 0.2s", fontFamily: "'Sora', sans-serif" }}>{label}</button>
  );
}

function Badge({ text, color }) {
  return <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600, background: color + "18", color }}>{text}</span>;
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ width: 32, height: 32, border: "3px solid rgba(212,168,67,0.15)", borderTopColor: "#D4A843", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// Extract lote from campaign name
function extractLote(name) {
  if (!name) return "Sem Lote";
  const match = name.match(/lote[\s_-]?(\d+)/i) || name.match(/L(\d+)/i) || name.match(/(\d+)[°ºo]\s*lote/i);
  if (match) return `Lote ${match[1]}`;
  if (name.includes("L1") || name.includes("Lote1") || name.includes("LOTE1")) return "Lote 1";
  if (name.includes("L2") || name.includes("Lote2") || name.includes("LOTE2")) return "Lote 2";
  if (name.includes("L3") || name.includes("Lote3") || name.includes("LOTE3")) return "Lote 3";
  return "Sem Lote";
}

export default function Dashboard() {
  const [activeAccount, setActiveAccount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [accountData, setAccountData] = useState({});
  const [sheetData, setSheetData] = useState({});
  const [dateRange, setDateRange] = useState({ since: "2025-12-01", until: new Date().toISOString().split("T")[0] });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeView, setActiveView] = useState("overview");
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [error, setError] = useState(null);
  const isMounted = useRef(true);

  const account = ACCOUNTS[activeAccount];
  const data = accountData[account.id] || {};

  const fetchAll = useCallback(async (accId) => {
    setLoading(true);
    setError(null);
    try {
      const timeRange = { since: dateRange.since, until: dateRange.until };

      const [insightsRes, campaignsRes, campaignInsightsRes, sheets] = await Promise.all([
        metaGet(`${accId}/insights`, {
          fields: "impressions,clicks,spend,reach,cpc,cpm,ctr,actions,cost_per_action_type,frequency",
          time_range: timeRange,
        }),
        metaGet(`${accId}/campaigns`, {
          fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,budget_remaining",
          limit: 100,
        }),
        metaGet(`${accId}/insights`, {
          fields: "campaign_id,campaign_name,impressions,clicks,spend,reach,ctr,cpc,cpm,actions,cost_per_action_type",
          time_range: timeRange,
          level: "campaign",
          limit: 100,
        }),
        fetchSheetData(),
      ]);

      setSheetData(sheets);

      const insights = insightsRes.data?.[0] || {};
      const campaigns = campaignsRes.data || [];
      const campaignInsights = campaignInsightsRes.data || [];

      const mergedCampaigns = campaigns.map(c => {
        const ci = campaignInsights.find(x => x.campaign_id === c.id);
        const spend = ci ? parseFloat(ci.spend || 0) : 0;

        // Match sheet data by campaign name
        let sheetRevenue = 0, sheetQty = 0;
        Object.entries(sheets).forEach(([key, val]) => {
          if (c.name && (c.name.includes(key) || key.includes(c.name) || 
              c.name.toLowerCase().includes(key.toLowerCase()))) {
            sheetRevenue += val.revenue;
            sheetQty += val.qty;
          }
        });

        const roas = spend > 0 && sheetRevenue > 0 ? sheetRevenue / spend : 0;
        const cpa = sheetQty > 0 ? spend / sheetQty : 0;
        const lote = extractLote(c.name);

        // Daily budget: use actual value, divide by 100 (Meta returns in cents)
        const dailyBudget = c.daily_budget ? parseFloat(c.daily_budget) / 100 : 0;

        return {
          ...c,
          spend,
          impressions: ci ? parseInt(ci.impressions || 0) : 0,
          clicks: ci ? parseInt(ci.clicks || 0) : 0,
          reach: ci ? parseInt(ci.reach || 0) : 0,
          ctr: ci ? parseFloat(ci.ctr || 0) : 0,
          cpc: ci ? parseFloat(ci.cpc || 0) : 0,
          cpm: ci ? parseFloat(ci.cpm || 0) : 0,
          leads: ci ? parseActions(ci.actions, "lead") : 0,
          purchases: ci ? parseActions(ci.actions, "purchase") : 0,
          landing_page_view: ci ? parseActions(ci.actions, "landing_page_view") : 0,
          video_view: ci ? parseActions(ci.actions, "video_view") : 0,
          messaging: ci ? parseActions(ci.actions, "onsite_conversion.messaging_conversation_started_7d") : 0,
          initiate_checkout: ci ? parseActions(ci.actions, "initiate_checkout") : 0,
          actions: ci?.actions || [],
          sheetRevenue,
          sheetQty,
          roas,
          cpa,
          lote,
          dailyBudget,
        };
      }).sort((a, b) => b.spend - a.spend);

      if (isMounted.current) {
        setAccountData(prev => ({
          ...prev,
          [accId]: {
            insights: {
              spend: parseFloat(insights.spend || 0),
              impressions: parseInt(insights.impressions || 0),
              clicks: parseInt(insights.clicks || 0),
              reach: parseInt(insights.reach || 0),
              ctr: parseFloat(insights.ctr || 0),
              cpc: parseFloat(insights.cpc || 0),
              cpm: parseFloat(insights.cpm || 0),
              frequency: parseFloat(insights.frequency || 0),
              leads: parseActions(insights.actions, "lead"),
              purchases: parseActions(insights.actions, "purchase"),
              landing_page_view: parseActions(insights.actions, "landing_page_view"),
              video_views: parseActions(insights.actions, "video_view"),
              messaging: parseActions(insights.actions, "onsite_conversion.messaging_conversation_started_7d"),
              initiate_checkout: parseActions(insights.actions, "initiate_checkout"),
              cpl: parseCPA(insights.cost_per_action_type, "lead"),
            },
            campaigns: mergedCampaigns,
            lastRefresh: new Date().toLocaleTimeString("pt-BR"),
          },
        }));
      }
    } catch (e) {
      console.error("Fetch error:", e);
      if (isMounted.current) setError(e.message);
    }
    if (isMounted.current) setLoading(false);
  }, [dateRange]);

  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);
  useEffect(() => { fetchAll(account.id); }, [activeAccount, dateRange]);

  const ins = data.insights || {};
  const campaigns = data.campaigns || [];
  const activeCampaigns = campaigns.filter(c => c.effective_status === "ACTIVE");
  const pausedCampaigns = campaigns.filter(c => c.effective_status !== "ACTIVE");

  const filterBySearch = (items) => {
    if (!searchTerm) return items;
    return items.filter(i => (i.name || "").toLowerCase().includes(searchTerm.toLowerCase()));
  };

  // Lotes grouping
  const loteMap = {};
  campaigns.forEach(c => {
    const lote = c.lote || "Sem Lote";
    if (!loteMap[lote]) loteMap[lote] = { spend: 0, leads: 0, sheetRevenue: 0, sheetQty: 0, impressions: 0, clicks: 0, campaigns: [], active: 0 };
    loteMap[lote].spend += c.spend || 0;
    loteMap[lote].leads += c.leads || 0;
    loteMap[lote].sheetRevenue += c.sheetRevenue || 0;
    loteMap[lote].sheetQty += c.sheetQty || 0;
    loteMap[lote].impressions += c.impressions || 0;
    loteMap[lote].clicks += c.clicks || 0;
    loteMap[lote].campaigns.push(c);
    if (c.effective_status === "ACTIVE") loteMap[lote].active += 1;
  });
  const sortedLotes = Object.entries(loteMap).sort(([a], [b]) => a.localeCompare(b));

  // Audience grouping
  const audienceMap = {};
  campaigns.forEach(c => {
    let audience = "Geral";
    if (c.name?.includes("Quente")) audience = "🔥 Quente";
    else if (c.name?.includes("Frio")) audience = "❄️ Frio";
    else if (c.name?.includes("RMKT") || c.name?.includes("Remarketing")) audience = "🔄 Remarketing";
    else if (c.name?.includes("Advantage")) audience = "🤖 Advantage+";
    else if (c.name?.includes("LAL") || c.name?.includes("Lookalike")) audience = "👯 Lookalike";
    else if (c.name?.includes("ListadeEspera")) audience = "📋 Lista de Espera";
    else if (c.name?.includes("WhatsApp")) audience = "💬 WhatsApp";
    else if (c.name?.includes("Profissoes") || c.name?.includes("Interesse")) audience = "🎯 Interesses";
    if (!audienceMap[audience]) audienceMap[audience] = { spend: 0, leads: 0, purchases: 0, impressions: 0, clicks: 0, campaigns: 0 };
    audienceMap[audience].spend += c.spend || 0;
    audienceMap[audience].leads += c.leads || 0;
    audienceMap[audience].purchases += c.purchases || 0;
    audienceMap[audience].impressions += c.impressions || 0;
    audienceMap[audience].clicks += c.clicks || 0;
    audienceMap[audience].campaigns += 1;
  });
  const sortedAudiences = Object.entries(audienceMap).sort(([, a], [, b]) => b.spend - a.spend);

  const spendByObjective = {};
  campaigns.forEach(c => {
    const obj = (c.objective || "OTHER").replace("OUTCOME_", "");
    spendByObjective[obj] = (spendByObjective[obj] || 0) + (c.spend || 0);
  });
  const pieData = Object.entries(spendByObjective).filter(([, v]) => v > 0).map(([k, v]) => ({ name: k, value: Math.round(v) }));
  const spendByStatus = [
    { name: "Ativas", value: activeCampaigns.reduce((s, c) => s + (c.spend || 0), 0) },
    { name: "Pausadas", value: pausedCampaigns.reduce((s, c) => s + (c.spend || 0), 0) },
  ].filter(d => d.value > 0);

  const PIE_COLORS = ["#D4A843", "#06B6D4", "#A78BFA", "#34D399", "#FB923C", "#F87171", "#60A5FA"];
  const STATUS_COLORS = ["#34D399", "#F87171"];
  const hookRate = ins.impressions > 0 && ins.video_views > 0 ? ((ins.video_views / ins.impressions) * 100) : 0;
  const totalDailyBudget = campaigns.filter(c => c.effective_status === "ACTIVE" && c.dailyBudget > 0).reduce((s, c) => s + c.dailyBudget, 0);
  const totalRevenue = campaigns.reduce((s, c) => s + (c.sheetRevenue || 0), 0);
  const totalRoas = ins.spend > 0 && totalRevenue > 0 ? totalRevenue / ins.spend : 0;

  const thStyle = (color = "#8888A0") => ({ padding: "10px 8px", background: `rgba(255,255,255,0.03)`, color, fontWeight: 600, textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.06)" });
  const tdStyle = { padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 11, whiteSpace: "nowrap" };

  return (
    <div style={{ fontFamily: "'Sora', sans-serif", background: "#08080E", color: "#E8E8EC", minHeight: "100vh", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse at 20% 0%, rgba(212,168,67,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(6,182,212,0.03) 0%, transparent 60%)", pointerEvents: "none", zIndex: 0 }} />

      {/* HEADER */}
      <div style={{ position: "relative", zIndex: 1, borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "16px 24px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34D399", boxShadow: "0 0 8px #34D399" }} />
              <h1 style={{ fontSize: 18, fontWeight: 800, color: "#D4A843", letterSpacing: -0.5 }}>SDA 2026 · META ADS COMMAND CENTER</h1>
            </div>
            <div style={{ fontSize: 11, color: "#555570", marginTop: 2 }}>Atualizado: {data.lastRefresh || "—"} · {dateRange.since} → {dateRange.until}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" value={dateRange.since} onChange={e => setDateRange(d => ({ ...d, since: e.target.value }))} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 10px", color: "#E8E8EC", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }} />
            <span style={{ color: "#555570" }}>→</span>
            <input type="date" value={dateRange.until} onChange={e => setDateRange(d => ({ ...d, until: e.target.value }))} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 10px", color: "#E8E8EC", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }} />
            <button onClick={() => fetchAll(account.id)} disabled={loading} style={{ padding: "8px 18px", background: loading ? "rgba(212,168,67,0.1)" : "linear-gradient(135deg, #D4A843, #B08A2E)", border: "none", borderRadius: 8, color: loading ? "#D4A843" : "#0A0A0F", fontWeight: 700, fontSize: 12, cursor: loading ? "wait" : "pointer", fontFamily: "'Sora', sans-serif" }}>
              {loading ? "⟳ Carregando..." : "⟳ Atualizar"}
            </button>
          </div>
        </div>
      </div>

      {/* ACCOUNT TABS */}
      <div style={{ position: "relative", zIndex: 1, padding: "16px 24px 0" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ACCOUNTS.map((acc, i) => (
            <Tab key={acc.id} label={`${acc.label} · ${acc.id.replace("act_", "")}`} active={activeAccount === i} onClick={() => { setActiveAccount(i); setSelectedCampaign(null); }} color={acc.color} />
          ))}
          <div style={{ flex: 1 }} />
          <input placeholder="🔍 Buscar campanha ou criativo..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 14px", color: "#E8E8EC", fontSize: 12, width: 280, fontFamily: "'Sora', sans-serif" }} />
        </div>
      </div>

      {/* VIEW TABS */}
      <div style={{ position: "relative", zIndex: 1, padding: "12px 24px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { id: "overview", label: "📊 Visão Geral" },
            { id: "campaigns", label: "🎯 Campanhas" },
            { id: "lotes", label: "📦 Lotes" },
            { id: "audiences", label: "👥 Públicos" },
          ].map(v => (
            <button key={v.id} onClick={() => setActiveView(v.id)} style={{ padding: "7px 16px", background: activeView === v.id ? "rgba(255,255,255,0.06)" : "transparent", border: "none", borderRadius: 8, color: activeView === v.id ? "#E8E8EC" : "#666680", fontSize: 12, fontWeight: activeView === v.id ? 600 : 400, cursor: "pointer", fontFamily: "'Sora', sans-serif", borderBottom: activeView === v.id ? `2px solid ${account.color}` : "2px solid transparent" }}>{v.label}</button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px 16px" }}>
          <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid #F87171", borderRadius: 10, padding: "12px 16px", color: "#F87171", fontSize: 12 }}>
            ⚠️ Erro: {error}
          </div>
        </div>
      )}

      <div style={{ position: "relative", zIndex: 1, padding: "0 24px 40px", maxWidth: 1400, margin: "0 auto" }}>
        <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>

        {loading && !data.insights ? <Spinner /> : (
          <>
            {/* ════ OVERVIEW ════ */}
            {activeView === "overview" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, marginBottom: 20 }}>
                  <KPI label="Gasto Total" value={fmtMoney(ins.spend)} icon="💰" color={account.color} />
                  <KPI label="Receita (Planilha)" value={fmtMoney(totalRevenue)} icon="💵" color="#34D399" />
                  <KPI label="ROAS Geral" value={fmtRoas(totalRoas)} icon="📈" color="#FB923C" sub={totalRevenue > 0 ? `R$ ${(totalRevenue/1000).toFixed(1)}k receita` : ""} />
                  <KPI label="CPC" value={fmtMoney(ins.cpc)} icon="🖱️" color="#60A5FA" sub={`${fmt(ins.clicks)} cliques`} />
                  <KPI label="CPM" value={fmtMoney(ins.cpm)} icon="📡" color="#A78BFA" sub={`${fmt(ins.impressions)} imp.`} />
                  <KPI label="CPL" value={fmtMoney(ins.cpl)} icon="📋" color="#34D399" sub={`${fmt(ins.leads)} leads`} />
                  <KPI label="CTR" value={fmtPct(ins.ctr)} icon="📈" color="#FB923C" />
                  <KPI label="Alcance" value={fmt(ins.reach)} icon="👁️" color="#06B6D4" sub={`Freq: ${ins.frequency?.toFixed(1) || "—"}`} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, marginBottom: 24 }}>
                  <KPI label="Leads" value={fmt(ins.leads)} icon="📋" color="#34D399" />
                  <KPI label="Visitas (LP)" value={fmt(ins.landing_page_view)} icon="🌐" color="#60A5FA" />
                  <KPI label="Hook Rate" value={fmtPct(hookRate)} icon="🎣" color="#FB923C" sub={`${fmt(ins.video_views)} views`} />
                  <KPI label="Orç. Diário Ativo" value={fmtMoney(totalDailyBudget)} icon="📅" color="#D4A843" sub={`${activeCampaigns.filter(c => c.dailyBudget > 0).length} campanhas CBO`} />
                  <KPI label="Vendas (Planilha)" value={fmt(campaigns.reduce((s,c) => s + (c.sheetQty||0), 0))} icon="🛒" color="#34D399" />
                  <KPI label="Checkouts" value={fmt(ins.initiate_checkout)} icon="🏷️" color="#A78BFA" sub={`Msgs: ${fmt(ins.messaging)}`} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#8888A0", marginBottom: 16 }}>GASTO POR OBJETIVO</div>
                    {pieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3} stroke="none">
                            {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={v => fmtMoney(v)} contentStyle={{ background: "#1A1A2E", border: "1px solid #333", borderRadius: 8, fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div style={{ color: "#555", textAlign: "center", padding: 40 }}>Sem dados</div>}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                      {pieData.map((d, i) => (
                        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#8888A0" }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          {d.name}: {fmtMoney(d.value)}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#8888A0", marginBottom: 16 }}>GASTO: ATIVAS vs PAUSADAS</div>
                    {spendByStatus.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={spendByStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3} stroke="none">
                            {spendByStatus.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i]} />)}
                          </Pie>
                          <Tooltip formatter={v => fmtMoney(v)} contentStyle={{ background: "#1A1A2E", border: "1px solid #333", borderRadius: 8, fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div style={{ color: "#555", textAlign: "center", padding: 40 }}>Sem dados</div>}
                    <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
                      {spendByStatus.map((d, i) => (
                        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COLORS[i] }} />
                          <span style={{ color: "#8888A0" }}>{d.name}:</span>
                          <span style={{ fontWeight: 700, color: STATUS_COLORS[i] }}>{fmtMoney(d.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#8888A0", marginBottom: 16 }}>TOP 10 CAMPANHAS POR GASTO</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={campaigns.slice(0, 10).map(c => ({ name: c.name?.substring(0, 35), spend: Math.round(c.spend), leads: c.leads }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#666680" }} angle={-20} textAnchor="end" height={80} />
                      <YAxis tick={{ fontSize: 10, fill: "#666680" }} />
                      <Tooltip contentStyle={{ background: "#1A1A2E", border: "1px solid #333", borderRadius: 8, fontSize: 11 }} formatter={v => fmtMoney(v)} />
                      <Bar dataKey="spend" fill={account.color} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ════ CAMPAIGNS ════ */}
            {activeView === "campaigns" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#34D399", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34D399" }} /> CAMPANHAS ATIVAS ({filterBySearch(activeCampaigns).length})
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr>{["Campanha", "Lote", "Obj.", "Gasto", "Orç/Dia", "Leads", "CPL", "Vendas", "Receita", "CPA", "ROAS", "CTR", "CPC", "CPM", "Alcance"].map((h, i) => (
                          <th key={h} style={thStyle(i < 3 ? "#34D399" : "#8888A0")}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {filterBySearch(activeCampaigns).map(c => (
                          <tr key={c.id} style={{ cursor: "pointer", transition: "background 0.15s" }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                            onClick={() => setSelectedCampaign(selectedCampaign?.id === c.id ? null : c)}>
                            <td style={{ ...tdStyle, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", fontWeight: 500 }} title={c.name}>{c.name}</td>
                            <td style={tdStyle}><Badge text={c.lote} color={account.color} /></td>
                            <td style={tdStyle}><Badge text={c.objective?.replace("OUTCOME_", "")} color="#A78BFA" /></td>
                            <td style={{ ...tdStyle, fontWeight: 600, color: account.color }}>{fmtMoney(c.spend)}</td>
                            <td style={{ ...tdStyle, color: "#D4A843" }}>{c.dailyBudget > 0 ? fmtMoney(c.dailyBudget) : "ABO"}</td>
                            <td style={tdStyle}>{fmt(c.leads)}</td>
                            <td style={{ ...tdStyle, color: c.leads > 0 && c.spend / c.leads < 30 ? "#34D399" : c.leads > 0 && c.spend / c.leads > 60 ? "#F87171" : "#E8E8EC" }}>{c.leads > 0 ? fmtMoney(c.spend / c.leads) : "—"}</td>
                            <td style={{ ...tdStyle, color: "#34D399" }}>{fmt(c.sheetQty)}</td>
                            <td style={{ ...tdStyle, color: "#34D399" }}>{c.sheetRevenue > 0 ? fmtMoney(c.sheetRevenue) : "—"}</td>
                            <td style={{ ...tdStyle, color: c.cpa > 0 && c.cpa < 300 ? "#34D399" : c.cpa > 500 ? "#F87171" : "#E8E8EC" }}>{c.cpa > 0 ? fmtMoney(c.cpa) : "—"}</td>
                            <td style={{ ...tdStyle, color: c.roas >= 3 ? "#34D399" : c.roas >= 1 ? "#FB923C" : c.roas > 0 ? "#F87171" : "#666680", fontWeight: 700 }}>{fmtRoas(c.roas)}</td>
                            <td style={tdStyle}>{fmtPct(c.ctr)}</td>
                            <td style={tdStyle}>{fmtMoney(c.cpc)}</td>
                            <td style={tdStyle}>{fmtMoney(c.cpm)}</td>
                            <td style={tdStyle}>{fmt(c.reach)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {selectedCampaign && (
                  <div style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${account.color}33`, borderRadius: 14, padding: 20, marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: account.color, marginBottom: 4 }}>{selectedCampaign.name}</div>
                        <div style={{ fontSize: 10, color: "#666680" }}>{selectedCampaign.lote} · {selectedCampaign.objective?.replace("OUTCOME_", "")} · {selectedCampaign.effective_status}</div>
                      </div>
                      <button onClick={() => setSelectedCampaign(null)} style={{ background: "none", border: "none", color: "#F87171", fontSize: 18, cursor: "pointer" }}>✕</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                      <KPI label="Gasto" value={fmtMoney(selectedCampaign.spend)} color={account.color} />
                      <KPI label="Orç. Diário" value={selectedCampaign.dailyBudget > 0 ? fmtMoney(selectedCampaign.dailyBudget) : "ABO"} color="#D4A843" />
                      <KPI label="Leads" value={fmt(selectedCampaign.leads)} color="#34D399" sub={selectedCampaign.leads > 0 ? `CPL ${fmtMoney(selectedCampaign.spend / selectedCampaign.leads)}` : ""} />
                      <KPI label="Vendas" value={fmt(selectedCampaign.sheetQty)} color="#34D399" />
                      <KPI label="Receita" value={fmtMoney(selectedCampaign.sheetRevenue)} color="#34D399" />
                      <KPI label="CPA" value={fmtMoney(selectedCampaign.cpa)} color="#A78BFA" />
                      <KPI label="ROAS" value={fmtRoas(selectedCampaign.roas)} color="#FB923C" />
                      <KPI label="CTR" value={fmtPct(selectedCampaign.ctr)} color="#FB923C" />
                      <KPI label="CPC" value={fmtMoney(selectedCampaign.cpc)} color="#60A5FA" />
                      <KPI label="CPM" value={fmtMoney(selectedCampaign.cpm)} color="#A78BFA" />
                      <KPI label="Impressões" value={fmt(selectedCampaign.impressions)} color="#06B6D4" />
                      <KPI label="Alcance" value={fmt(selectedCampaign.reach)} color="#D4A843" />
                    </div>
                  </div>
                )}

                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#F87171", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#F87171" }} /> CAMPANHAS PAUSADAS ({filterBySearch(pausedCampaigns).filter(c => c.spend > 0).length})
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr>{["Campanha", "Lote", "Gasto", "Leads", "CPL", "Vendas", "Receita", "CPA", "ROAS", "CTR"].map((h, i) => (
                          <th key={h} style={thStyle(i < 2 ? "#F87171" : "#8888A0")}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {filterBySearch(pausedCampaigns).filter(c => c.spend > 0).map(c => (
                          <tr key={c.id} style={{ opacity: 0.7, cursor: "pointer" }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = 0.7; e.currentTarget.style.background = "transparent"; }}>
                            <td style={{ ...tdStyle, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }} title={c.name}>{c.name}</td>
                            <td style={tdStyle}><Badge text={c.lote} color="#666" /></td>
                            <td style={tdStyle}>{fmtMoney(c.spend)}</td>
                            <td style={tdStyle}>{fmt(c.leads)}</td>
                            <td style={tdStyle}>{c.leads > 0 ? fmtMoney(c.spend / c.leads) : "—"}</td>
                            <td style={{ ...tdStyle, color: "#34D399" }}>{fmt(c.sheetQty)}</td>
                            <td style={{ ...tdStyle, color: "#34D399" }}>{c.sheetRevenue > 0 ? fmtMoney(c.sheetRevenue) : "—"}</td>
                            <td style={tdStyle}>{c.cpa > 0 ? fmtMoney(c.cpa) : "—"}</td>
                            <td style={{ ...tdStyle, color: c.roas >= 3 ? "#34D399" : c.roas > 0 ? "#FB923C" : "#666680", fontWeight: 700 }}>{fmtRoas(c.roas)}</td>
                            <td style={tdStyle}>{fmtPct(c.ctr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ════ LOTES ════ */}
            {activeView === "lotes" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ fontSize: 12, color: "#8888A0", marginBottom: 20, padding: "14px 18px", background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                  📦 Agrupamento por lote identificado no nome das campanhas. ROAS e CPA calculados com dados da planilha comercial (excluindo congelados).
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                  {sortedLotes.map(([lote, d]) => {
                    const roas = d.spend > 0 && d.sheetRevenue > 0 ? d.sheetRevenue / d.spend : 0;
                    const cpa = d.sheetQty > 0 ? d.spend / d.sheetQty : 0;
                    return (
                      <div key={lote} style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${account.color}22`, borderRadius: 16, padding: 20, transition: "border-color 0.2s" }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = account.color + "55"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = account.color + "22"}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: account.color }}>📦 {lote}</div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Badge text={`${d.active} ativas`} color="#34D399" />
                            <Badge text={`${d.campaigns.length} total`} color="#666680" />
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px" }}>
                            <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase", marginBottom: 4 }}>Gasto</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: account.color, fontFamily: "'JetBrains Mono', monospace" }}>{fmtMoney(d.spend)}</div>
                          </div>
                          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px" }}>
                            <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase", marginBottom: 4 }}>Receita</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "#34D399", fontFamily: "'JetBrains Mono', monospace" }}>{d.sheetRevenue > 0 ? fmtMoney(d.sheetRevenue) : "—"}</div>
                          </div>
                          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px" }}>
                            <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase", marginBottom: 4 }}>ROAS</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: roas >= 3 ? "#34D399" : roas >= 1 ? "#FB923C" : roas > 0 ? "#F87171" : "#666680", fontFamily: "'JetBrains Mono', monospace" }}>{fmtRoas(roas)}</div>
                          </div>
                          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px" }}>
                            <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase", marginBottom: 4 }}>CPA</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: cpa > 0 && cpa < 300 ? "#34D399" : cpa > 500 ? "#F87171" : "#E8E8EC", fontFamily: "'JetBrains Mono', monospace" }}>{cpa > 0 ? fmtMoney(cpa) : "—"}</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 11, color: "#8888A0" }}>
                          <span>📋 {fmt(d.leads)} leads</span>
                          <span>🛒 {fmt(d.sheetQty)} vendas</span>
                          <span>CTR {d.impressions > 0 ? fmtPct((d.clicks / d.impressions) * 100) : "—"}</span>
                        </div>
                        {/* Campaigns in lote */}
                        <div style={{ marginTop: 12 }}>
                          {d.campaigns.slice(0, 5).map(c => (
                            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 10 }}>
                              <span style={{ color: c.effective_status === "ACTIVE" ? "#E8E8EC" : "#555570", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }} title={c.name}>
                                {c.effective_status === "ACTIVE" ? "🟢" : "⏸️"} {c.name}
                              </span>
                              <span style={{ color: account.color, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>{fmtMoney(c.spend)}</span>
                            </div>
                          ))}
                          {d.campaigns.length > 5 && <div style={{ fontSize: 10, color: "#555570", marginTop: 4 }}>+{d.campaigns.length - 5} campanhas</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ════ AUDIENCES ════ */}
            {activeView === "audiences" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ fontSize: 12, color: "#8888A0", marginBottom: 20, padding: "14px 18px", background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                  👥 Públicos agrupados por tipo identificado no nome das campanhas.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                  {sortedAudiences.filter(([, d]) => d.spend > 0).map(([name, d]) => (
                    <div key={name} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 18, transition: "border-color 0.2s" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = account.color + "44"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{name}</div>
                      <div style={{ fontSize: 10, color: "#666680", marginBottom: 12 }}>{d.campaigns} campanhas</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: account.color, fontFamily: "'JetBrains Mono', monospace" }}>{fmtMoney(d.spend)}</div>
                          <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase" }}>Gasto</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: "#34D399", fontFamily: "'JetBrains Mono', monospace" }}>{fmt(d.leads)}</div>
                          <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase" }}>Leads</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: d.leads > 0 && d.spend / d.leads < 30 ? "#34D399" : d.leads > 0 && d.spend / d.leads > 60 ? "#F87171" : "#E8E8EC", fontFamily: "'JetBrains Mono', monospace" }}>
                            {d.leads > 0 ? fmtMoney(d.spend / d.leads) : "—"}
                          </div>
                          <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase" }}>CPL</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 10, color: "#666680" }}>
                        <span>🛒 {fmt(d.purchases)} compras</span>
                        <span>CTR {d.impressions > 0 ? fmtPct((d.clicks / d.impressions) * 100) : "—"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
