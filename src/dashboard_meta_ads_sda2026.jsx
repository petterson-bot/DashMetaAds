import { useState, useEffect, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";

// ─── CONFIG ───
const ACCOUNTS = [
  { id: "act_629328937757745", label: "Conta 03", color: "#06B6D4" },
  { id: "act_377480853270622", label: "Conta 04", color: "#D4A843" },
];

const API_URL = "https://api.anthropic.com/v1/messages";
const MCP_SERVER = { type: "url", url: "https://meta.euoscar.com", name: "Meta Ads Connector" };

// ─── API HELPER ───
async function callMCP(toolName, params) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1000,
        system: `You are a data extraction assistant. When given a Meta Ads tool request, execute it and return ONLY valid JSON with the raw data. No commentary. If the tool returns data, extract the key fields into a clean JSON array. Always respond with valid JSON only, no markdown.`,
        messages: [{ role: "user", content: `Call tool ${toolName} with params: ${JSON.stringify(params)}. Return only the raw JSON result.` }],
        mcp_servers: [MCP_SERVER],
      }),
    });
    const data = await res.json();
    const textBlocks = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
    const toolResults = data.content?.filter(b => b.type === "mcp_tool_result").map(b => b.content?.[0]?.text || "").join("\n") || "";
    return toolResults || textBlocks;
  } catch (e) {
    console.error("MCP Error:", e);
    return null;
  }
}

// ─── PARSING HELPERS ───
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
  if (n === null || n === undefined || isNaN(n)) return "R$ —";
  return `R$ ${parseFloat(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (!n || isNaN(n)) return "—";
  return `${parseFloat(n).toFixed(2)}%`;
}

// ─── COMPONENTS ───

// KPI Card
function KPI({ label, value, sub, color = "#D4A843", icon }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${color}22`,
      borderRadius: 14,
      padding: "18px 16px",
      textAlign: "center",
      transition: "all 0.25s",
      cursor: "default",
      position: "relative",
      overflow: "hidden",
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = color + "66"; e.currentTarget.style.transform = "translateY(-2px)"; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = color + "22"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: 0.4 }} />
      <div style={{ fontSize: 10, color: "#8888A0", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#666680", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Tab Button
function Tab({ label, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 24px",
        background: active ? color + "18" : "transparent",
        border: `1px solid ${active ? color : "rgba(255,255,255,0.08)"}`,
        borderRadius: 10,
        color: active ? color : "#8888A0",
        fontWeight: active ? 700 : 400,
        fontSize: 13,
        cursor: "pointer",
        transition: "all 0.2s",
        fontFamily: "'Sora', sans-serif",
      }}
    >
      {label}
    </button>
  );
}

// Badge
function Badge({ text, color }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 10,
      fontWeight: 600,
      background: color + "18",
      color,
    }}>{text}</span>
  );
}

// Spinner
function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{
        width: 32, height: 32, border: "3px solid rgba(212,168,67,0.15)",
        borderTopColor: "#D4A843", borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// MAIN COMPONENT
export default function Dashboard() {
  const [activeAccount, setActiveAccount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [accountData, setAccountData] = useState({});
  const [dateRange, setDateRange] = useState({ since: "2025-12-01", until: "2026-03-03" });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeView, setActiveView] = useState("overview"); // overview, campaigns, adsets, ads, audiences
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const isMounted = useRef(true);

  const account = ACCOUNTS[activeAccount];
  const data = accountData[account.id] || {};

  // ─── FETCH DATA ───
  const fetchAccountData = useCallback(async (accId) => {
    setLoading(true);
    try {
      // 1. Account Insights
      const insightsRaw = await callMCP("get_account_insights", {
        account_id: accId,
        fields: ["impressions","clicks","spend","reach","cpc","cpm","ctr","actions","cost_per_action_type","frequency"],
        time_range: { since: dateRange.since, until: dateRange.until },
      });

      // 2. Campaigns
      const campaignsRaw = await callMCP("execute_api", {
        endpoint: `${accId}/campaigns`,
        method: "GET",
        params: { fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time", limit: 100 },
      });

      // 3. Campaign-level insights
      const campaignInsightsRaw = await callMCP("execute_api", {
        endpoint: `${accId}/insights`,
        method: "GET",
        params: {
          fields: "campaign_id,campaign_name,impressions,clicks,spend,reach,ctr,cpc,cpm,actions,cost_per_action_type",
          time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
          level: "campaign",
          limit: 50,
        },
      });

      // Parse results
      let insights = {};
      try {
        const parsed = JSON.parse(insightsRaw);
        insights = parsed?.data?.[0] || parsed || {};
      } catch { insights = {}; }

      let campaigns = [];
      try {
        const parsed = JSON.parse(campaignsRaw);
        campaigns = parsed?.data || [];
      } catch { campaigns = []; }

      let campaignInsights = [];
      try {
        const parsed = JSON.parse(campaignInsightsRaw);
        campaignInsights = parsed?.data || [];
      } catch { campaignInsights = []; }

      // Merge campaign data with insights
      const mergedCampaigns = campaigns.map(c => {
        const ci = campaignInsights.find(x => x.campaign_id === c.id);
        return {
          ...c,
          spend: ci ? parseFloat(ci.spend) : 0,
          impressions: ci ? parseInt(ci.impressions) : 0,
          clicks: ci ? parseInt(ci.clicks) : 0,
          reach: ci ? parseInt(ci.reach || 0) : 0,
          ctr: ci ? parseFloat(ci.ctr) : 0,
          cpc: ci ? parseFloat(ci.cpc) : 0,
          cpm: ci ? parseFloat(ci.cpm) : 0,
          leads: ci ? parseActions(ci.actions, "lead") : 0,
          purchases: ci ? parseActions(ci.actions, "purchase") : 0,
          landing_page_view: ci ? parseActions(ci.actions, "landing_page_view") : 0,
          video_view: ci ? parseActions(ci.actions, "video_view") : 0,
          link_click: ci ? parseActions(ci.actions, "link_click") : 0,
          messaging: ci ? parseActions(ci.actions, "onsite_conversion.messaging_conversation_started_7d") : 0,
          initiate_checkout: ci ? parseActions(ci.actions, "initiate_checkout") : 0,
          actions: ci?.actions || [],
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
    }
    if (isMounted.current) setLoading(false);
  }, [dateRange]);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Initial load
  useEffect(() => {
    fetchAccountData(account.id);
  }, [activeAccount]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAccountData(account.id).then(() => setRefreshing(false));
  };

  const ins = data.insights || {};
  const campaigns = data.campaigns || [];
  const activeCampaigns = campaigns.filter(c => c.effective_status === "ACTIVE");
  const pausedCampaigns = campaigns.filter(c => c.effective_status !== "ACTIVE");

  // Search filter
  const filterBySearch = (items) => {
    if (!searchTerm) return items;
    const term = searchTerm.toLowerCase();
    return items.filter(i => (i.name || "").toLowerCase().includes(term));
  };

  // Pie chart data
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

  // Hook Rate calc: (video_views / impressions) * 100
  const hookRate = ins.impressions > 0 && ins.video_views > 0 ? ((ins.video_views / ins.impressions) * 100) : 0;

  // Daily budget total
  const totalDailyBudget = campaigns.filter(c => c.effective_status === "ACTIVE" && c.daily_budget)
    .reduce((s, c) => s + parseInt(c.daily_budget || 0), 0) / 100;

  return (
    <div style={{
      fontFamily: "'Sora', sans-serif",
      background: "#08080E",
      color: "#E8E8EC",
      minHeight: "100vh",
      position: "relative",
    }}>
      {/* FONTS */}
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* BG TEXTURE */}
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse at 20% 0%, rgba(212,168,67,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(6,182,212,0.03) 0%, transparent 60%)", pointerEvents: "none", zIndex: 0 }} />

      {/* HEADER */}
      <div style={{ position: "relative", zIndex: 1, borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "16px 24px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34D399", boxShadow: "0 0 8px #34D399" }} />
              <h1 style={{ fontSize: 18, fontWeight: 800, color: "#D4A843", letterSpacing: -0.5 }}>SDA 2026 · META ADS COMMAND CENTER</h1>
            </div>
            <div style={{ fontSize: 11, color: "#555570", marginTop: 2 }}>
              Atualizado: {data.lastRefresh || "—"} · {dateRange.since} → {dateRange.until}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Date inputs */}
            <input
              type="date"
              value={dateRange.since}
              onChange={e => setDateRange(d => ({ ...d, since: e.target.value }))}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 10px", color: "#E8E8EC", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
            />
            <span style={{ color: "#555570", fontSize: 11 }}>→</span>
            <input
              type="date"
              value={dateRange.until}
              onChange={e => setDateRange(d => ({ ...d, until: e.target.value }))}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 10px", color: "#E8E8EC", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
            />
            <button
              onClick={handleRefresh}
              disabled={loading}
              style={{
                padding: "8px 18px", background: loading ? "rgba(212,168,67,0.1)" : "linear-gradient(135deg, #D4A843, #B08A2E)",
                border: "none", borderRadius: 8, color: loading ? "#D4A843" : "#0A0A0F", fontWeight: 700, fontSize: 12, cursor: loading ? "wait" : "pointer",
                fontFamily: "'Sora', sans-serif", transition: "all 0.2s",
              }}
            >
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
          {/* Search */}
          <div style={{ position: "relative" }}>
            <input
              placeholder="Buscar campanha ou criativo..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10, padding: "8px 14px 8px 34px", color: "#E8E8EC", fontSize: 12, width: 280,
                fontFamily: "'Sora', sans-serif",
              }}
            />
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#555570", fontSize: 14 }}>🔍</span>
          </div>
        </div>
      </div>

      {/* VIEW TABS */}
      <div style={{ position: "relative", zIndex: 1, padding: "12px 24px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", gap: 6 }}>
          {[
            { id: "overview", label: "📊 Visão Geral" },
            { id: "campaigns", label: "🎯 Campanhas" },
            { id: "ads", label: "🎨 Criativos" },
            { id: "audiences", label: "👥 Públicos" },
          ].map(v => (
            <button key={v.id} onClick={() => setActiveView(v.id)} style={{
              padding: "7px 16px", background: activeView === v.id ? "rgba(255,255,255,0.06)" : "transparent",
              border: "none", borderRadius: 8, color: activeView === v.id ? "#E8E8EC" : "#666680",
              fontSize: 12, fontWeight: activeView === v.id ? 600 : 400, cursor: "pointer", fontFamily: "'Sora', sans-serif",
              borderBottom: activeView === v.id ? `2px solid ${account.color}` : "2px solid transparent",
            }}>{v.label}</button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ position: "relative", zIndex: 1, padding: "0 24px 40px", maxWidth: 1400, margin: "0 auto" }}>

        {loading && !data.insights ? <Spinner /> : (
          <>
            {/* ════════ OVERVIEW ════════ */}
            {activeView === "overview" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>

                {/* PRIMARY KPIs */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, marginBottom: 20 }}>
                  <KPI label="Gasto Total" value={fmtMoney(ins.spend)} icon="💰" color={account.color} />
                  <KPI label="CPC" value={fmtMoney(ins.cpc)} icon="🖱️" color="#60A5FA" sub={`${fmt(ins.clicks)} cliques`} />
                  <KPI label="CPM" value={fmtMoney(ins.cpm)} icon="📡" color="#A78BFA" sub={`${fmt(ins.impressions)} imp.`} />
                  <KPI label="CPL" value={fmtMoney(ins.cpl)} icon="📋" color="#34D399" sub={`${fmt(ins.leads)} leads`} />
                  <KPI label="CTR" value={fmtPct(ins.ctr)} icon="📈" color="#FB923C" />
                  <KPI label="Alcance" value={fmt(ins.reach)} icon="👁️" color="#06B6D4" sub={`Freq: ${ins.frequency?.toFixed(1) || "—"}`} />
                </div>

                {/* SECONDARY KPIs */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, marginBottom: 24 }}>
                  <KPI label="Leads" value={fmt(ins.leads)} icon="📋" color="#34D399" />
                  <KPI label="Visitas (LP)" value={fmt(ins.landing_page_view)} icon="🌐" color="#60A5FA" />
                  <KPI label="Hook Rate" value={fmtPct(hookRate)} icon="🎣" color="#FB923C" sub={`${fmt(ins.video_views)} views`} />
                  <KPI label="Orç. Diário Ativo" value={fmtMoney(totalDailyBudget)} icon="📅" color="#D4A843" sub={`${activeCampaigns.filter(c => c.daily_budget).length} campanhas CBO`} />
                  <KPI label="Compras (Pixel)" value={fmt(ins.purchases)} icon="🛒" color="#34D399" sub={ins.purchases > 0 ? `CPA ${fmtMoney(ins.spend / ins.purchases)}` : ""} />
                  <KPI label="Checkouts" value={fmt(ins.initiate_checkout)} icon="🏷️" color="#A78BFA" sub={`Msgs: ${fmt(ins.messaging)}`} />
                </div>

                {/* CHARTS ROW */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                  {/* Spend by Objective */}
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#8888A0", marginBottom: 16 }}>GASTO POR OBJETIVO</div>
                    {pieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" paddingAngle={3} stroke="none">
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

                  {/* Spend by Status */}
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#8888A0", marginBottom: 16 }}>GASTO: ATIVAS vs PAUSADAS</div>
                    {spendByStatus.length > 0 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={spendByStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" paddingAngle={3} stroke="none">
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

                {/* TOP CAMPAIGNS BAR CHART */}
                <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20, marginBottom: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#8888A0", marginBottom: 16 }}>TOP 10 CAMPANHAS POR GASTO</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={campaigns.slice(0, 10).map(c => ({
                      name: c.name?.replace(/SDA2026-Meta_/g, "").replace(/ME_MAPAESCALA[-_]/g, "").substring(0, 35),
                      spend: Math.round(c.spend),
                      leads: c.leads,
                    }))}>
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

            {/* ════════ CAMPAIGNS ════════ */}
            {activeView === "campaigns" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <style>{`@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }`}</style>

                {/* Active campaigns */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#34D399", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34D399" }} />
                    CAMPANHAS ATIVAS ({filterBySearch(activeCampaigns).length})
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr>
                          {["Campanha", "Objetivo", "Gasto", "Leads", "CPL", "Compras", "CPA", "CTR", "CPC", "CPM", "Orç/Dia", "Impressões", "Alcance"].map(h => (
                            <th key={h} style={{ padding: "10px 8px", background: "rgba(52,211,153,0.06)", color: "#34D399", fontWeight: 600, textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filterBySearch(activeCampaigns).map(c => (
                          <tr key={c.id} style={{ cursor: "pointer", transition: "background 0.15s" }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                            onClick={() => setSelectedCampaign(c)}
                          >
                            <td style={{ padding: "8px", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{c.name?.replace("SDA2026-Meta_", "").replace("ME_MAPAESCALA-", "")}</td>
                            <td style={{ padding: "8px", borderBottom: "1px solid rgba(255,255,255,0.02)" }}><Badge text={c.objective?.replace("OUTCOME_", "")} color="#A78BFA" /></td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: account.color, borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmtMoney(c.spend)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmt(c.leads)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", color: c.leads > 0 && c.spend / c.leads < 30 ? "#34D399" : c.leads > 0 && c.spend / c.leads > 60 ? "#F87171" : "#E8E8EC", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{c.leads > 0 ? fmtMoney(c.spend / c.leads) : "—"}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmt(c.purchases)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", color: c.purchases > 0 && c.spend / c.purchases < 300 ? "#34D399" : "#E8E8EC", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{c.purchases > 0 ? fmtMoney(c.spend / c.purchases) : "—"}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmtPct(c.ctr)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmtMoney(c.cpc)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmtMoney(c.cpm)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", color: "#D4A843", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{c.daily_budget ? fmtMoney(parseInt(c.daily_budget) / 100) : "ABO"}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmt(c.impressions)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmt(c.reach)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Paused campaigns */}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#F87171", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#F87171" }} />
                    CAMPANHAS PAUSADAS ({filterBySearch(pausedCampaigns).length})
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr>
                          {["Campanha", "Objetivo", "Gasto", "Leads", "CPL", "Compras", "CPA", "CTR"].map(h => (
                            <th key={h} style={{ padding: "10px 8px", background: "rgba(248,113,113,0.06)", color: "#F87171", fontWeight: 600, textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filterBySearch(pausedCampaigns).filter(c => c.spend > 0).map(c => (
                          <tr key={c.id}
                            style={{ opacity: 0.7, cursor: "pointer" }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = 0.7; e.currentTarget.style.background = "transparent"; }}
                            onClick={() => setSelectedCampaign(c)}
                          >
                            <td style={{ padding: "8px", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{c.name?.replace("SDA2026-Meta_", "").replace("ME_MAPAESCALA-", "")}</td>
                            <td style={{ padding: "8px", borderBottom: "1px solid rgba(255,255,255,0.02)" }}><Badge text={c.objective?.replace("OUTCOME_", "")} color="#666" /></td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmtMoney(c.spend)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmt(c.leads)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{c.leads > 0 ? fmtMoney(c.spend / c.leads) : "—"}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmt(c.purchases)}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{c.purchases > 0 ? fmtMoney(c.spend / c.purchases) : "—"}</td>
                            <td style={{ padding: "8px", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{fmtPct(c.ctr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ════════ ADS / CRIATIVOS ════════ */}
            {activeView === "ads" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <style>{`@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }`}</style>
                <div style={{ fontSize: 12, color: "#8888A0", marginBottom: 16, padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                  💡 Para ver criativos de uma campanha, vá em <strong style={{ color: "#D4A843" }}>Campanhas</strong> e clique em uma. Os criativos mais eficientes serão destacados abaixo.
                </div>

                {/* Campaign selector for ad view */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: "#8888A0", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Selecione uma campanha para ver criativos:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {campaigns.filter(c => c.spend > 100).slice(0, 15).map(c => (
                      <button key={c.id} onClick={() => setSelectedCampaign(c)} style={{
                        padding: "6px 12px", background: selectedCampaign?.id === c.id ? account.color + "20" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${selectedCampaign?.id === c.id ? account.color : "rgba(255,255,255,0.06)"}`,
                        borderRadius: 8, color: selectedCampaign?.id === c.id ? account.color : "#8888A0",
                        fontSize: 10, cursor: "pointer", fontFamily: "'Sora', sans-serif", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {c.effective_status === "ACTIVE" ? "🟢" : "⏸️"} {c.name?.replace("SDA2026-Meta_", "").replace("ME_MAPAESCALA-", "").substring(0, 40)}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedCampaign && (
                  <div style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${account.color}33`, borderRadius: 14, padding: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: account.color }}>{selectedCampaign.name?.replace("SDA2026-Meta_", "")}</div>
                        <div style={{ fontSize: 10, color: "#666680", marginTop: 2 }}>
                          {selectedCampaign.objective?.replace("OUTCOME_", "")} · {selectedCampaign.effective_status} · Gasto: {fmtMoney(selectedCampaign.spend)}
                        </div>
                      </div>
                      <Badge text={selectedCampaign.effective_status} color={selectedCampaign.effective_status === "ACTIVE" ? "#34D399" : "#F87171"} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                      <KPI label="Gasto" value={fmtMoney(selectedCampaign.spend)} color={account.color} />
                      <KPI label="Leads" value={fmt(selectedCampaign.leads)} color="#34D399" sub={selectedCampaign.leads > 0 ? `CPL ${fmtMoney(selectedCampaign.spend / selectedCampaign.leads)}` : ""} />
                      <KPI label="Compras" value={fmt(selectedCampaign.purchases)} color="#A78BFA" sub={selectedCampaign.purchases > 0 ? `CPA ${fmtMoney(selectedCampaign.spend / selectedCampaign.purchases)}` : ""} />
                      <KPI label="CTR" value={fmtPct(selectedCampaign.ctr)} color="#FB923C" />
                      <KPI label="CPC" value={fmtMoney(selectedCampaign.cpc)} color="#60A5FA" />
                      <KPI label="Views LP" value={fmt(selectedCampaign.landing_page_view)} color="#06B6D4" />
                      <KPI label="Vídeo Views" value={fmt(selectedCampaign.video_view)} color="#D4A843" sub={selectedCampaign.impressions > 0 ? `Hook: ${((selectedCampaign.video_view / selectedCampaign.impressions) * 100).toFixed(1)}%` : ""} />
                      <KPI label="Checkouts" value={fmt(selectedCampaign.initiate_checkout)} color="#34D399" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ════════ AUDIENCES ════════ */}
            {activeView === "audiences" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <style>{`@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }`}</style>
                <div style={{ fontSize: 12, color: "#8888A0", marginBottom: 20, padding: "14px 18px", background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                  👥 Os públicos são definidos no nível de <strong style={{ color: "#D4A843" }}>Conjunto de Anúncios (Ad Set)</strong>. Abaixo, os dados agrupados por nome de público extraído dos ad sets.
                </div>

                {/* Extract audience names from campaigns */}
                {(() => {
                  const audienceMap = {};
                  campaigns.forEach(c => {
                    // Extract audience hint from campaign name
                    const parts = c.name?.split("_") || [];
                    let audience = "Geral";
                    if (c.name?.includes("Quente")) audience = "🔥 Quente";
                    if (c.name?.includes("Frio")) audience = "❄️ Frio";
                    if (c.name?.includes("RMKT") || c.name?.includes("Remarketing")) audience = "🔄 Remarketing";
                    if (c.name?.includes("Advantage")) audience = "🤖 Advantage+";
                    if (c.name?.includes("LAL") || c.name?.includes("Lookalike")) audience = "👯 Lookalike";
                    if (c.name?.includes("ListadeEspera")) audience = "📋 Lista de Espera";
                    if (c.name?.includes("WhatsApp")) audience = "💬 WhatsApp";
                    if (c.name?.includes("Profissoes") || c.name?.includes("Interesse")) audience = "🎯 Interesses";

                    if (!audienceMap[audience]) audienceMap[audience] = { spend: 0, leads: 0, purchases: 0, impressions: 0, clicks: 0, campaigns: 0 };
                    audienceMap[audience].spend += c.spend || 0;
                    audienceMap[audience].leads += c.leads || 0;
                    audienceMap[audience].purchases += c.purchases || 0;
                    audienceMap[audience].impressions += c.impressions || 0;
                    audienceMap[audience].clicks += c.clicks || 0;
                    audienceMap[audience].campaigns += 1;
                  });

                  const sorted = Object.entries(audienceMap).sort(([, a], [, b]) => b.spend - a.spend);

                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                      {sorted.filter(([, d]) => d.spend > 0).map(([name, d]) => (
                        <div key={name} style={{
                          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                          borderRadius: 14, padding: 18, transition: "border-color 0.2s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = account.color + "44"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"}
                        >
                          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{name}</div>
                          <div style={{ fontSize: 10, color: "#666680", marginBottom: 12 }}>{d.campaigns} campanhas</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 16, fontWeight: 800, color: account.color, fontFamily: "'JetBrains Mono', monospace" }}>{fmtMoney(d.spend)}</div>
                              <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase" }}>Gasto</div>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 16, fontWeight: 800, color: "#34D399", fontFamily: "'JetBrains Mono', monospace" }}>{fmt(d.leads)}</div>
                              <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase" }}>Leads</div>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 16, fontWeight: 800, color: d.leads > 0 && d.spend / d.leads < 30 ? "#34D399" : d.leads > 0 && d.spend / d.leads > 60 ? "#F87171" : "#E8E8EC", fontFamily: "'JetBrains Mono', monospace" }}>
                                {d.leads > 0 ? fmtMoney(d.spend / d.leads) : "—"}
                              </div>
                              <div style={{ fontSize: 9, color: "#666680", textTransform: "uppercase" }}>CPL</div>
                            </div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 10, color: "#666680" }}>
                            <span>🛒 {fmt(d.purchases)} compras</span>
                            <span>{d.purchases > 0 ? `CPA ${fmtMoney(d.spend / d.purchases)}` : ""}</span>
                            <span>CTR {d.impressions > 0 ? fmtPct((d.clicks / d.impressions) * 100) : "—"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* CAMPAIGN DETAIL MODAL */}
        {selectedCampaign && activeView === "campaigns" && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            background: "linear-gradient(to top, #12121AEE, #12121ACC)", backdropFilter: "blur(20px)",
            borderTop: `2px solid ${account.color}`, padding: 20, zIndex: 100,
            animation: "slideUp 0.3s ease",
          }}>
            <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
            <div style={{ maxWidth: 1400, margin: "0 auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: account.color }}>
                  📊 {selectedCampaign.name?.replace("SDA2026-Meta_", "").replace("ME_MAPAESCALA-", "")}
                </div>
                <button onClick={() => setSelectedCampaign(null)} style={{ background: "none", border: "none", color: "#F87171", fontSize: 18, cursor: "pointer" }}>✕</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                <KPI label="Gasto" value={fmtMoney(selectedCampaign.spend)} color={account.color} />
                <KPI label="Leads" value={fmt(selectedCampaign.leads)} color="#34D399" sub={selectedCampaign.leads > 0 ? `CPL ${fmtMoney(selectedCampaign.spend / selectedCampaign.leads)}` : ""} />
                <KPI label="Compras" value={fmt(selectedCampaign.purchases)} color="#A78BFA" sub={selectedCampaign.purchases > 0 ? `CPA ${fmtMoney(selectedCampaign.spend / selectedCampaign.purchases)}` : ""} />
                <KPI label="Cliques" value={fmt(selectedCampaign.clicks)} color="#60A5FA" sub={`CPC ${fmtMoney(selectedCampaign.cpc)}`} />
                <KPI label="CTR" value={fmtPct(selectedCampaign.ctr)} color="#FB923C" />
                <KPI label="CPM" value={fmtMoney(selectedCampaign.cpm)} color="#A78BFA" />
                <KPI label="Hook Rate" value={selectedCampaign.impressions > 0 ? fmtPct((selectedCampaign.video_view / selectedCampaign.impressions) * 100) : "—"} color="#D4A843" />
                <KPI label="Views LP" value={fmt(selectedCampaign.landing_page_view)} color="#06B6D4" />
                <KPI label="Checkouts" value={fmt(selectedCampaign.initiate_checkout)} color="#34D399" />
                <KPI label="Msgs WA" value={fmt(selectedCampaign.messaging)} color="#25D366" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
