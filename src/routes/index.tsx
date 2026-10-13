import { useMemo, useState, useRef, useEffect, lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Bell, Bot, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleHelp, Database, FileCheck2, FileText, Filter, Globe2,
  Layers3, LayoutDashboard, Map, Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
  Play, Plus, Search, Settings2, ShieldCheck, Sparkles, Target, UploadCloud, Users,
  X, Send, Satellite, MapPin, TrendingUp, Eye, Lock, CheckCircle2, Clock, AlertCircle,
  Zap, BarChart3, Navigation,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ozarDataset, processingSteps, recentActivity, surveySummaries,
  claimants, getClaimantsBySurvey, simulateNLResponse, routeBadge,
  type SurveyStatus, type SurveySummary, type RouteDecision,
} from "@/lib/ozar-data";

import OfficerLoginModal, { type OfficerProfile } from "@/components/OfficerLoginModal";
import UrbanHarmonizationDashboard from "@/components/UrbanHarmonizationDashboard";
import VillageCadastreDirectoryPage from "@/components/VillageCadastreDirectoryPage";
import TerritorialAnalyticsPage from "@/components/TerritorialAnalyticsPage";

// SSR-safe client-only dynamic imports for map libraries (OpenLayers / Leaflet)
const NakashaMap = lazy(() => import("@/components/NakashaMap"));
const SatelliteCadastralMap = lazy(() =>
  import("@/components/SatelliteCadastralMap").then((m) => ({
    default: m.SatelliteCadastralMap,
  }))
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VANMITRA | Maharashtra Cadastral & Land Intelligence" },
      { name: "description", content: "AI-powered geospatial harmonization & MahaBhuNakasha cadastral intelligence." },
      { property: "og:title", content: "VANMITRA | Maharashtra Cadastral & Land Intelligence" },
      { property: "og:description", content: "AI-powered geospatial harmonization & MahaBhuNakasha cadastral intelligence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" },
    ],
  }),
  component: Index,
});

type ViewKey = "Nakasha Dashboard" | "Full Screen Map" | "Village Cadastre Directory" | "Territorial Analytics";

const navigation: { label: ViewKey; icon: typeof LayoutDashboard; section?: string }[] = [
  { label: "Nakasha Dashboard",          icon: LayoutDashboard },
  { label: "Full Screen Map",            icon: Map },
  { label: "Village Cadastre Directory", icon: Layers3, section: "NAKASHA INTELLIGENCE" },
  { label: "Territorial Analytics",      icon: BarChart3 },
];

const statusClasses: Record<SurveyStatus, string> = {
  Verified:           "border-emerald-200 bg-emerald-50 text-emerald-800",
  "Under review":     "border-amber-200 bg-amber-50 text-amber-800",
  Conflict:           "border-red-200 bg-red-50 text-red-800",
  "Field verification": "border-sky-200 bg-sky-50 text-sky-800",
};

const routeConfig: Record<RouteDecision, { label: string; color: string; bg: string; border: string }> = {
  auto_publish:     { label: "🟢 Auto-Published",   color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200" },
  human_review:     { label: "🟡 Officer Review",   color: "text-amber-700",   bg: "bg-amber-50",    border: "border-amber-200"   },
  send_to_surveyor: { label: "🔴 Send to Surveyor", color: "text-red-700",     bg: "bg-red-50",      border: "border-red-200"     },
};

function Index() {
  const [mounted,         setMounted]         = useState(false);
  const [showMap,         setShowMap]         = useState(true);
  const [activeView,      setActiveView]      = useState<ViewKey>("Nakasha Dashboard");
  const [collapsed,       setCollapsed]       = useState(false);
  const [selectedSurvey,  setSelectedSurvey]  = useState("324");
  const [search,          setSearch]          = useState("");
  const [notice,          setNotice]          = useState<string | null>(null);
  const [layerState,      setLayerState]      = useState({ imagery: true, boundaries: true, conflicts: true, golden: false });

  // Officer authentication state
  const [currentUser, setCurrentUser] = useState<OfficerProfile | null>(() => {
    try {
      const saved = localStorage.getItem("vanmitra_officer_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  const handleLoginSuccess = (user: OfficerProfile) => {
    setCurrentUser(user);
    try {
      localStorage.setItem("vanmitra_officer_user", JSON.stringify(user));
    } catch {}
    setLoginModalOpen(false);
    setShowMap(false); // Seamlessly transition to Officer Dashboard
    showNotice(`Welcome, Officer ${user.name}!`);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem("vanmitra_officer_user");
    } catch {}
    setShowMap(true); // Return to public Nakasha WebGIS
    showNotice("Logged out successfully.");
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  const visibleNav = navigation.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase()) || search.length < 2
  );

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2800);
  };

  // ── SSR splash (prevents canvas/window errors during server rendering) ──────
  if (!mounted) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 text-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          <span className="text-sm font-medium tracking-wide">Initializing VANMITRA Nakasha GIS...</span>
        </div>
      </div>
    );
  }

  // ── Landing page: full-screen Nakasha map ──────────────────────────────────
  if (showMap) {
    return (
      <Suspense
        fallback={
          <div className="flex h-screen w-screen items-center justify-center bg-white text-slate-900">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
              <span className="text-sm font-medium tracking-wide">Loading Nakasha Map...</span>
            </div>
          </div>
        }
      >
        <NakashaMap
          currentUser={currentUser}
          onOpenLogin={() => setLoginModalOpen(true)}
          onOpenConsole={() => setShowMap(false)}
          onLogout={handleLogout}
        />
        <OfficerLoginModal
          isOpen={loginModalOpen}
          open={loginModalOpen}
          onClose={() => setLoginModalOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ── Header (Light Theme with TEAM VANMITRA Logo & Officer Profile) ── */}
      <header className="sticky top-0 z-30 flex h-[70px] items-center border-b border-slate-200 bg-white px-4 text-slate-800 shadow-sm md:px-7">
        <div className={`flex shrink-0 items-center gap-3 ${collapsed ? "w-[58px]" : "w-[246px]"}`}>
          <img
            src="/vanmitra_icon.png"
            alt="TEAM VANMITRA"
            className="h-11 w-11 object-contain rounded-full shadow-xs cursor-pointer hover:scale-105 transition-all"
          />
          {!collapsed && (
            <div>
              <div className="font-display text-lg font-extrabold tracking-tight text-slate-900">VANMITRA</div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-700">Officer Dashboard</div>
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          {/* Back to Nakasha Map Button */}
          <button
            onClick={() => setShowMap(true)}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-all shadow-xs cursor-pointer active:scale-95"
          >
            <span>🗺</span> <span>Back to Nakasha Map</span>
          </button>
          <div className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 md:flex font-medium">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" /> Synced
          </div>
          <Button variant="ghost" size="icon" className="text-slate-600 hover:bg-slate-100 size-9" aria-label="Notifications">
            <Bell className="size-4" />
          </Button>

          {/* Profile Section in Top Right Corner */}
          {currentUser ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="size-8 rounded-full bg-emerald-700 font-bold text-white text-xs flex items-center justify-center shadow-xs">
                {currentUser.avatar || "AO"}
              </div>
              <div className="hidden xl:block text-left text-xs">
                <div className="font-bold text-slate-900 leading-tight truncate max-w-[130px]">{currentUser.name}</div>
                <div className="text-[10px] text-emerald-700 font-semibold truncate max-w-[130px]">{currentUser.role}</div>
              </div>
              <button
                onClick={handleLogout}
                className="text-xs text-slate-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 font-medium cursor-pointer transition-colors"
                title="Logout"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <button
                onClick={() => setLoginModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 shadow-sm transition-all cursor-pointer"
              >
                <span>🔐</span><span>Login</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex">
        {/* ── Sidebar ── */}
        {/* ── Sidebar ── */}
        <aside className={`sticky top-[70px] hidden h-[calc(100vh-70px)] shrink-0 flex-col border-r border-slate-200 bg-white py-5 transition-all lg:flex ${collapsed ? "w-[78px] px-3" : "w-[260px] px-4"}`}>
          <div className={`mb-5 flex items-center ${collapsed ? "justify-center" : "justify-between px-2"}`}>
            {!collapsed && <div className="text-[10px] font-bold uppercase tracking-[0.17em] text-slate-400">Navigation</div>}
            <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)} className="text-slate-400 hover:bg-slate-100 hover:text-slate-800" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </div>
          <nav className="space-y-1">
            {visibleNav.map((item) => (
              <div key={item.label}>
                {item.section && !collapsed && <div className="mb-2 mt-4 px-2 text-[10px] font-bold uppercase tracking-[0.17em] text-slate-400">{item.section}</div>}
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (item.label === "Full Screen Map") {
                      setShowMap(true);
                    } else {
                      setActiveView(item.label);
                    }
                  }}
                  className={`w-full justify-start gap-3 ${collapsed ? "px-0 justify-center" : "px-3"} ${activeView === item.label ? "bg-emerald-50 font-bold text-emerald-900 hover:bg-emerald-100 hover:text-emerald-950" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className={`size-[18px] ${activeView === item.label ? "text-emerald-700" : "text-slate-500"}`} />
                  {!collapsed && item.label}
                </Button>
              </div>
            ))}
          </nav>
          {!collapsed && (
            <div className="mt-auto rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-2 shadow-xs">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
                <Sparkles className="size-3.5 text-emerald-600" />
                <span>MahaBhuNakasha Live GIS</span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-600">
                Direct WMS integration with 43,665 real Maharashtra villages & cadastral parcels.
              </p>
              <Button
                onClick={() => setShowMap(true)}
                size="sm"
                className="h-8 w-full bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold shadow-xs cursor-pointer"
              >
                🗺 Open Full Nakasha WebGIS
              </Button>
            </div>
          )}
        </aside>

        {/* ── Main ── */}
        <main className="min-w-0 flex-1 page-grid">
          <div className="border-b border-slate-200 bg-white/80 px-4 py-2.5 backdrop-blur md:px-7 shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-bold text-emerald-800">Maharashtra State GIS</span>
              <ChevronRight className="size-3 text-slate-400" />
              <span className="text-slate-700 font-medium">Cadastral & Village Land Records (36 Districts • 43,665 Villages)</span>
              <ChevronRight className="size-3 text-slate-400" />
              <span className="font-semibold text-slate-900">{activeView}</span>
              <span className="ml-auto hidden text-[11px] md:block text-slate-500 font-medium">
                Smart India Hackathon 2026 • PS 26013
              </span>
            </div>
          </div>
          <div className="mx-auto max-w-[1440px] p-4 md:p-7">
            {activeView === "Village Cadastre Directory" ? (
              <VillageCadastreDirectoryPage
                onOpenFullMap={() => setShowMap(true)}
                onNotice={showNotice}
              />
            ) : activeView === "Territorial Analytics" ? (
              <TerritorialAnalyticsPage
                onOpenFullMap={() => setShowMap(true)}
                onNotice={showNotice}
              />
            ) : (
              <UrbanHarmonizationDashboard
                onOpenFullMap={() => setShowMap(true)}
                onNavigate={setActiveView}
                onNotice={showNotice}
              />
            )}
          </div>
        </main>
      </div>

      {notice && (
        <div className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-forest/20 bg-card px-4 py-3 text-sm font-medium text-forest-deep panel-shadow">
          <Check className="size-4 text-forest" /> {notice}
          <Button variant="ghost" size="icon" onClick={() => setNotice(null)} className="ml-1 size-6"><X className="size-3" /></Button>
        </div>
      )}

      <OfficerLoginModal
        isOpen={loginModalOpen}
        open={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAP EXPLORER — Full Bhumi-Nakasha cadastral intelligence panel
// ════════════════════════════════════════════════════════════════════════════

function MapExplorer({ selectedSurvey, setSelectedSurvey, layerState, setLayerState, onNotice }: {
  selectedSurvey: string;
  setSelectedSurvey: (v: string) => void;
  layerState: Record<string, boolean>;
  setLayerState: (v: Record<string, boolean>) => void;
  onNotice: (v: string) => void;
}) {
  const [claimSearch,    setClaimSearch]    = useState("");
  const [statusFilter,   setStatusFilter]   = useState<string>("All");
  const [nlQuery,        setNlQuery]        = useState("");
  const [nlMessages,     setNlMessages]     = useState<{ from: "user" | "ai"; text: string }[]>([
    { from: "ai", text: "Bhumi-Nakasha GIS Assistant ready. Ask me about survey numbers, claimants, areas, or conflicts in Ozar Village." },
  ]);
  const [mapZoom, setMapZoom] = useState(1);
  const nlRef = useRef<HTMLDivElement>(null);

  const selectedSummary = surveySummaries.find((s) => s.surveyNumber === selectedSurvey) ?? surveySummaries[0];
  const selectedClaimants = getClaimantsBySurvey(selectedSurvey);

  const filteredClaimants = useMemo(() => {
    const q = claimSearch.toLowerCase();
    let list = claimants;
    if (statusFilter !== "All") {
      const matchingSurveys = surveySummaries.filter((s) => s.status === statusFilter).map((s) => s.surveyNumber);
      list = list.filter((c) => matchingSurveys.includes(c.surveyNo));
    }
    if (q) list = list.filter((c) => c.nameEnglish.toLowerCase().includes(q) || c.nameMarathi.includes(q) || c.surveyNo.includes(q) || String(c.districtCaseNo).includes(q));
    return list;
  }, [claimSearch, statusFilter]);

  const sendNLQuery = () => {
    if (!nlQuery.trim()) return;
    const userMsg = nlQuery.trim();
    const aiReply = simulateNLResponse(userMsg, selectedSurvey);
    setNlMessages((prev) => [...prev, { from: "user", text: userMsg }, { from: "ai", text: aiReply }]);
    setNlQuery("");
    setTimeout(() => nlRef.current?.scrollTo({ top: 9999, behavior: "smooth" }), 80);
  };

  const routeCfg = routeConfig[selectedSummary.route];

  const surveyColor = (s: SurveySummary) => {
    if (s.status === "Conflict")           return { border: "#ef4444", fill: "rgba(254,226,226,0.7)", text: "#991b1b" };
    if (s.status === "Under review")       return { border: "#f59e0b", fill: "rgba(254,243,199,0.7)", text: "#92400e" };
    if (s.status === "Field verification") return { border: "#0ea5e9", fill: "rgba(224,242,254,0.7)", text: "#075985" };
    return                                        { border: "#16a34a", fill: "rgba(220,252,231,0.7)", text: "#14532d" };
  };

  return (
    <div className="flex-1 h-full min-h-0 flex flex-col gap-2 overflow-hidden">
      {/* Header compact bar */}
      <section className="flex items-center justify-between gap-3 shrink-0 pb-1">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-forest">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" /> Palghar District · Ozar Village CFR
          </div>
          <h1 className="font-display text-xl font-bold tracking-tight text-forest-deep">
            Cadastral Map & Parcel Geofence Intelligence
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onNotice("Cadastral boundaries export prepared.")} className="h-8 gap-1.5 text-xs">
            <ArrowDownToLine className="size-3.5" /> Export GeoJSON
          </Button>
          <Button size="sm" onClick={() => onNotice("Field verification request created for Survey No. 324 (Palghar CFR).")} className="h-8 gap-1.5 bg-forest text-primary-foreground hover:bg-forest-deep text-xs">
            <Target className="size-3.5" /> Field verification
          </Button>
        </div>
      </section>

      {/* ── Main 3-panel layout (full-height flex-1) ── */}
      <div className="flex-1 min-h-0 grid overflow-hidden rounded-xl border border-border bg-card panel-shadow" style={{ gridTemplateColumns: "250px 1fr 340px" }}>

        {/* ━━━ LEFT PANEL — Layers + Claimant list ━━━ */}
        <div className="flex flex-col border-r border-border h-full overflow-hidden">
          {/* Layers */}
          <div className="border-b border-border p-3 shrink-0">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-xs font-bold text-forest-deep">Layers</h2>
              <Layers3 className="size-3.5 text-forest" />
            </div>
            <div className="space-y-1">
              {[["imagery","Satellite imagery"],["boundaries","Cadastral boundaries"],["conflicts","Conflict zones"],["golden","Golden records"]].map(([key, label]) => (
                <button key={key} onClick={() => setLayerState({ ...layerState, [key]: !layerState[key] })} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-secondary">
                  <span className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${layerState[key] ? "bg-forest" : "bg-muted-foreground/30"}`} />
                    {label}
                  </span>
                  <span className={`relative h-4 w-8 rounded-full transition-colors ${layerState[key] ? "bg-forest" : "bg-muted"}`}>
                    <span className={`absolute top-0.5 size-3 rounded-full bg-background transition-transform ${layerState[key] ? "translate-x-4" : "translate-x-0.5"}`} />
                  </span>
                </button>
              ))}
            </div>
            {/* Status filter */}
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Filter by status</div>
              <div className="flex flex-wrap gap-1">
                {["All", "Conflict", "Under review", "Verified", "Field verification"].map((s) => (
                  <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${statusFilter === s ? "bg-forest text-white" : "bg-secondary text-muted-foreground hover:bg-forest-soft"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {/* Legend */}
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Legend</div>
              <div className="space-y-1.5 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-2"><span className="size-3 rounded-sm border-2 border-red-500 bg-red-50" /> Conflict</div>
                <div className="flex items-center gap-2"><span className="size-3 rounded-sm border-2 border-amber-400 bg-amber-50" /> Under review</div>
                <div className="flex items-center gap-2"><span className="size-3 rounded-sm border-2 border-emerald-500 bg-emerald-50" /> Verified</div>
                <div className="flex items-center gap-2"><span className="size-3 rounded-sm border-2 border-sky-400 bg-sky-50" /> Field verification</div>
              </div>
            </div>
          </div>

          {/* Claimant list */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-border p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <input value={claimSearch} onChange={(e) => setClaimSearch(e.target.value)} placeholder="Search claimants..." className="w-full rounded-md border border-border bg-secondary py-1.5 pl-7 pr-2 text-xs outline-none focus:border-forest focus:ring-1 focus:ring-forest" />
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">{filteredClaimants.length} claimants</div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: "340px" }}>
              {filteredClaimants.map((c) => {
                const s = surveySummaries.find((sv) => sv.surveyNumber === c.surveyNo);
                const color = s ? surveyColor(s) : { border: "#6b7280", fill: "", text: "#374151" };
                return (
                  <button key={c.srNo} onClick={() => setSelectedSurvey(c.surveyNo)} className={`flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left transition-colors hover:bg-forest-soft/40 ${selectedSurvey === c.surveyNo ? "bg-forest-soft/60" : ""}`}>
                    <span className="mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: color.fill, color: color.text, border: `1px solid ${color.border}` }}>
                      S-{c.surveyNo}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-semibold text-foreground">{c.nameEnglish}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{c.nameMarathi} · {(c.areaSqm / 10000).toFixed(2)} ha</div>
                    </div>
                  </button>
                );
              })}
              {filteredClaimants.length === 0 && (
                <div className="p-4 text-center text-xs text-muted-foreground">No claimants match your filter.</div>
              )}
            </div>
          </div>
        </div>

        {/* ━━━ CENTER — Interactive Satellite & Cadastral Geofenced Map ━━━ */}
        <div className="relative flex flex-col overflow-hidden" style={{ minHeight: 480 }}>
          <div className="relative flex-1 w-full min-h-[460px]">
            <Suspense
              fallback={
                <div className="flex h-[460px] w-full items-center justify-center bg-muted/20 text-xs text-muted-foreground">
                  Loading Cadastral Map...
                </div>
              }
            >
              <SatelliteCadastralMap
                selectedSurvey={selectedSurvey}
                onSelectSurvey={setSelectedSurvey}
                layerState={layerState as any}
                onNotice={showNotice}
              />
            </Suspense>
          </div>

          {/* NL Query bar at bottom of map */}
          <div className="border-t border-border bg-card">
            <div className="p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-forest-deep">
                <Bot className="size-3.5 text-signal" /> Bhumi-Nakasha NL Assistant · Survey {selectedSurvey}
              </div>
              <div ref={nlRef} className="mb-2 max-h-28 overflow-y-auto space-y-1.5 text-xs">
                {nlMessages.map((m, i) => (
                  <div key={i} className={`rounded px-2 py-1.5 text-[11px] leading-relaxed ${m.from === "ai" ? "bg-forest-soft text-forest-deep" : "ml-4 bg-secondary text-foreground"}`}>
                    {m.from === "ai" && <span className="mr-1 font-bold">AI:</span>}
                    {m.text}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={nlQuery} onChange={(e) => setNlQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendNLQuery()} placeholder={`Ask about Survey ${selectedSurvey}...`} className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs outline-none focus:border-forest focus:ring-1 focus:ring-forest" />
                <button onClick={sendNLQuery} className="grid size-7 place-items-center rounded-md bg-forest text-white hover:bg-forest-deep" aria-label="Send query">
                  <Send className="size-3.5" />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {["Show claimants", "Total area?", "Conflict status", "Confidence score"].map((q) => (
                  <button key={q} onClick={() => { setNlQuery(q); }} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-forest-soft hover:text-forest-deep">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ━━━ RIGHT PANEL — Bhumi-Nakasha Cadastral Intelligence ━━━ */}
        <div className="flex flex-col overflow-hidden border-l border-border h-full">
          {/* Survey header (pinned top) */}
          <div className={`border-b border-border p-3.5 shrink-0 ${selectedSummary.status === "Conflict" ? "bg-red-50/80" : selectedSummary.status === "Under review" ? "bg-amber-50/80" : "bg-emerald-50/80"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Selected survey</div>
                <div className="mt-0.5 font-display text-xl font-bold text-forest-deep">No. {selectedSurvey}</div>
              </div>
              <Badge className={statusClasses[selectedSummary.status]}>{selectedSummary.status}</Badge>
            </div>
            {/* Route decision badge */}
            <div className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${routeCfg.border} ${routeCfg.bg} ${routeCfg.color}`}>
              {routeCfg.label}
            </div>
            {selectedSummary.issue && (
              <div className="mt-1.5 rounded-md border border-current/20 bg-white/70 px-2.5 py-1.5 text-[10.5px] leading-tight text-red-800">
                <b>⚠ Issue:</b> {selectedSummary.issue}
              </div>
            )}
          </div>

          {/* Middle scrollable content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Stats row */}
            <div className="grid grid-cols-3 border-b border-border divide-x divide-border bg-secondary/30">
              {[
                { label: "Claims", value: selectedSummary.claimCount },
                { label: "Confidence", value: `${selectedSummary.confidence}%` },
                { label: "Area", value: `${(selectedSummary.totalAreaSqm / 10000).toFixed(1)} ha` },
              ].map((stat) => (
                <div key={stat.label} className="p-2.5 text-center">
                  <div className="font-display text-lg font-bold text-forest-deep">{stat.value}</div>
                  <div className="text-[9.5px] text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Confidence bar */}
            <div className="border-b border-border px-3.5 py-2.5">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">AI confidence</span>
                <b className={selectedSummary.confidence < 75 ? "text-red-600" : selectedSummary.confidence < 85 ? "text-amber-600" : "text-emerald-600"}>{selectedSummary.confidence}%</b>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full transition-all ${selectedSummary.confidence < 75 ? "bg-red-500" : selectedSummary.confidence < 85 ? "bg-amber-400" : "bg-emerald-500"}`}
                  style={{ width: `${selectedSummary.confidence}%` }}
                />
              </div>
            </div>

            {/* 8-stage AI Pipeline */}
            <div className="border-b border-border px-3.5 py-2.5">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-forest-deep">
                <Zap className="size-3 text-signal" /> Bhumi-Nakasha Pipeline (Palghar CFR)
              </div>
              <div className="space-y-1.5">
                {processingSteps.map((step, i) => (
                  <div key={step.label} className="flex items-start gap-2">
                    <div className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[8.5px] font-bold ${step.state === "Completed" ? "bg-emerald-100 text-emerald-700" : step.state === "Processing" ? "bg-amber-100 text-amber-700" : "bg-secondary text-muted-foreground"}`}>
                      {step.state === "Completed" ? <Check className="size-2.5" /> : step.state === "Processing" ? <Activity className="size-2.5" /> : <span>{i + 1}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10.5px] font-medium leading-tight text-foreground">{step.label}</div>
                      <div className="text-[9.5px] leading-tight text-muted-foreground">{step.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Claimants for this survey */}
            <div className="border-b border-border px-3.5 py-2 flex items-center justify-between bg-secondary/40">
              <div className="text-[11px] font-bold text-forest-deep">Claimants · Survey {selectedSurvey}</div>
              <span className="rounded-full bg-forest-soft px-2 py-0.5 text-[9.5px] font-bold text-forest-deep">{selectedClaimants.length}</span>
            </div>
            <div>
              {selectedClaimants.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">No claimants for this survey.</div>
              ) : (
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-secondary/90 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 font-semibold">Name</th>
                      <th className="px-2 py-1.5 font-semibold text-right">Area</th>
                      <th className="px-2 py-1.5 font-semibold text-right">Case</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selectedClaimants.map((c) => (
                      <tr key={c.srNo} className="transition-colors hover:bg-secondary/40">
                        <td className="px-3 py-1.5">
                          <div className="text-[10.5px] font-semibold text-foreground leading-tight">{c.nameEnglish}</div>
                          <div className="text-[9.5px] text-muted-foreground leading-tight">{c.nameMarathi}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right text-[10.5px] text-muted-foreground whitespace-nowrap">
                          {(c.areaSqm / 10000).toFixed(2)} ha
                        </td>
                        <td className="px-2 py-1.5 text-right text-[9.5px] text-muted-foreground whitespace-nowrap">
                          #{c.districtCaseNo}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Action buttons (pinned bottom) */}
          <div className="border-t border-border p-2.5 space-y-1.5 shrink-0 bg-background">
            <Button className="w-full bg-forest text-primary-foreground hover:bg-forest-deep text-xs h-7.5" onClick={() => onNotice(`Survey No. ${selectedSurvey} opened in review queue.`)}>
              <Eye className="size-3.5 mr-1.5" /> View claim records
            </Button>
            <Button variant="outline" className="w-full text-xs h-7.5" onClick={() => onNotice("Golden Record creation is gated until officer approval.")}>
              <ShieldCheck className="size-3.5 mr-1.5" /> Create Golden Record
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════

function Dashboard({ onNavigate, onSelect }: { onNavigate: (view: ViewKey) => void; onSelect: (survey: string) => void }) {
  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-forest"><span className="size-2 rounded-full bg-signal" /> Live pilot workspace</div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-forest-deep md:text-4xl">Good morning, Officer</h1>
          <p className="mt-2 text-sm text-muted-foreground">Monitor and manage the Ozar Village land record harmonization pilot.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onNavigate("Datasets")} className="gap-2"><UploadCloud className="size-4" /> Add dataset</Button>
          <Button onClick={() => onNavigate("Map Explorer")} className="gap-2 bg-forest text-primary-foreground hover:bg-forest-deep"><Map className="size-4" /> Open map</Button>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-xl bg-forest-deep p-6 text-primary-foreground panel-shadow md:p-8">
        <div className="absolute right-0 top-0 h-full w-1/2 opacity-30" style={{ backgroundImage: "linear-gradient(120deg, transparent 20%, var(--signal) 20.5%, transparent 21%), linear-gradient(35deg, transparent 45%, var(--primary-foreground) 45.5%, transparent 46%)", backgroundSize: "68px 68px" }} />
        <div className="relative max-w-2xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-signal"><Sparkles className="size-4" /> Bhumi-Nakasha Harmonization</div>
          <h2 className="font-display text-2xl font-bold md:text-3xl">A clearer view of Ozar land claims.</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-primary-foreground/70">VANMITRA brings register attributes, survey boundaries and cadastral intelligence into one traceable workspace — powered by the 8-stage GeoAI engine.</p>
          <div className="mt-6 flex flex-wrap gap-6 text-sm">
            <div><div className="text-2xl font-bold">{ozarDataset.totalClaims}</div><div className="text-primary-foreground/60">source claims</div></div>
            <div className="h-10 w-px bg-primary-foreground/20" />
            <div><div className="text-2xl font-bold">{ozarDataset.uniqueSurveys}</div><div className="text-primary-foreground/60">survey numbers</div></div>
            <div className="h-10 w-px bg-primary-foreground/20" />
            <div><div className="text-2xl font-bold text-signal">30</div><div className="text-primary-foreground/60">active alerts</div></div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total claim records", String(ozarDataset.totalClaims), "Source register", Database, "text-forest"],
          ["Unique survey numbers", String(ozarDataset.uniqueSurveys), "Cadastral groups", Map, "text-forest"],
          ["Pending review", "30", "20.4% of claims", FileCheck2, "text-signal"],
          ["Critical conflict", "324", "116 linked claims", AlertTriangle, "text-red-600"],
        ].map(([label, value, note, Icon, color]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-card p-5 panel-shadow">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
                <div className="mt-2 font-display text-3xl font-bold text-foreground">{value}</div>
              </div>
              <div className={`grid size-9 place-items-center rounded-lg bg-secondary ${color}`}><Icon className="size-4" /></div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><ArrowUpRight className="size-3 text-forest" /> {note}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <div className="rounded-lg border border-border bg-card p-5 panel-shadow md:p-6">
          <div className="flex items-center justify-between">
            <div><h2 className="font-display text-lg font-bold text-forest-deep">Claims by survey number</h2><p className="mt-1 text-xs text-muted-foreground">The Survey No. 324 cluster is the primary review signal.</p></div>
            <Button variant="ghost" size="icon" onClick={() => onSelect("324")} aria-label="Open survey 324"><ArrowUpRight className="size-4" /></Button>
          </div>
          <div className="mt-7 space-y-4">
            <Bar label="Survey No. 324" value={116} max={116} tone="alert" onClick={() => onSelect("324")} />
            <Bar label="Survey No. 316" value={18} max={116} tone="forest" onClick={() => onSelect("316")} />
            <Bar label="Other 10 surveys" value={13} max={116} tone="forest" onClick={() => onNavigate("Datasets")} />
          </div>
          <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><AlertTriangle className="size-4 text-signal" /> 79% of all source claims share one survey number (No. 324).</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 panel-shadow md:p-6">
          <div className="flex items-center justify-between">
            <div><h2 className="font-display text-lg font-bold text-forest-deep">Harmonization status</h2><p className="mt-1 text-xs text-muted-foreground">Derived AI workflow output</p></div>
            <Button variant="ghost" size="icon" onClick={() => onNavigate("Processing Center")} aria-label="View processing center"><MoreHorizontal className="size-4" /></Button>
          </div>
          <div className="mt-6 flex items-center gap-7">
            <div className="relative grid size-32 shrink-0 place-items-center rounded-full" style={{ background: "conic-gradient(var(--forest) 0 63%, var(--signal) 63% 83%, oklch(0.72 0.14 25) 83% 94%, oklch(0.82 0.08 220) 94% 100%)" }}>
              <div className="grid size-24 place-items-center rounded-full bg-card"><div className="text-center"><div className="font-display text-2xl font-bold text-forest-deep">68%</div><div className="text-[10px] text-muted-foreground">harmonized</div></div></div>
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              {[["Verified","63%","bg-forest"],["Under review","20%","bg-signal"],["Conflicted","11%","bg-red-500"],["Field verification","6%","bg-sky-500"]].map(([label, value, color]) => (
                <div key={label} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-muted-foreground"><span className={`size-2 rounded-full ${color}`} />{label}</span><b className="text-foreground">{value}</b></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-border bg-card p-5 panel-shadow">
          <div className="flex items-center justify-between">
            <div><h2 className="font-display text-lg font-bold text-forest-deep">Review attention</h2><p className="mt-1 text-xs text-muted-foreground">AI-ranked work items</p></div>
            <Button variant="link" onClick={() => onNavigate("Review Queue")} className="text-forest">View queue</Button>
          </div>
          <div className="mt-4 divide-y divide-border">
            {surveySummaries.filter((s) => s.status !== "Verified").slice(0, 5).map((survey) => (
              <button key={survey.surveyNumber} onClick={() => onSelect(survey.surveyNumber)} className="flex w-full items-center gap-3 py-4 text-left transition-colors hover:bg-secondary/60">
                <div className={`grid size-9 place-items-center rounded-lg ${survey.status === "Conflict" ? "bg-red-50 text-red-600" : "bg-signal-soft text-forest-deep"}`}><AlertTriangle className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">Survey No. {survey.surveyNumber}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{survey.issue ?? "Attribute harmonization"} · {survey.claimCount} records</div>
                </div>
                <Badge className={statusClasses[survey.status]}>{survey.status}</Badge>
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 panel-shadow">
          <div className="flex items-center justify-between">
            <div><h2 className="font-display text-lg font-bold text-forest-deep">Recent activity</h2><p className="mt-1 text-xs text-muted-foreground">System and officer events</p></div>
            <Activity className="size-4 text-forest" />
          </div>
          <div className="mt-5 space-y-5">
            {recentActivity.map((event, index) => (
              <div key={event.time} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`mt-1 size-2.5 rounded-full ${index === 1 ? "bg-signal" : "bg-forest"}`} />
                  {index < recentActivity.length - 1 && <span className="mt-1 h-full w-px bg-border" />}
                </div>
                <div className="pb-1">
                  <div className="text-sm font-medium">{event.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{event.detail} <span className="ml-2 text-[10px]">{event.time}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col items-start justify-between gap-4 rounded-lg border border-forest/15 bg-forest-soft/50 p-5 md:flex-row md:items-center">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-card text-forest"><FileText className="size-5" /></div>
          <div>
            <div className="text-sm font-semibold text-forest-deep">Smart India Hackathon 2026</div>
            <div className="mt-1 text-xs text-ink-soft">Problem Statement 26013 · Automated Integration and Intelligent Harmonization of Multi-source Geospatial Data for Urban Land Record Management</div>
          </div>
        </div>
        <Badge variant="outline" className="whitespace-nowrap border-forest/20 bg-background text-forest-deep">Team Vanmitra</Badge>
      </section>
    </div>
  );
}

function Bar({ label, value, max, tone, onClick }: { label: string; value: number; max: number; tone: "alert" | "forest"; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group block w-full text-left">
      <div className="mb-2 flex justify-between text-xs"><span className="font-medium text-foreground">{label}</span><span className="text-muted-foreground">{value} claims</span></div>
      <div className="h-3 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full transition-all group-hover:brightness-95 ${tone === "alert" ? "bg-signal" : "bg-forest"}`} style={{ width: `${(value / max) * 100}%` }} /></div>
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function PageHeading({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle: string; actions?: React.ReactNode }) {
  return (
    <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-forest">{eyebrow}</div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-forest-deep">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODULE VIEW (all other views)
// ════════════════════════════════════════════════════════════════════════════

function ModuleView({ view, onNavigate, onNotice }: { view: ViewKey; onNavigate: (view: ViewKey) => void; onNotice: (message: string) => void }) {
  const [filter, setFilter] = useState("");
  const isReview = view === "Review Queue" || view === "Conflicts";
  const isReports = view === "Reports";
  const isAI = view === "AI Assistant";
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([{ from: "ai", text: `Good morning. I can query the Ozar register and explain harmonization decisions. There are ${ozarDataset.totalClaims} source claims across ${ozarDataset.uniqueSurveys} survey numbers. Try asking about Survey No. 324 or the claimant list.` }]);
  const filtered = surveySummaries.filter((item) => item.surveyNumber.toLowerCase().includes(filter.toLowerCase()) || item.status.toLowerCase().includes(filter.toLowerCase()));

  if (isAI) return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeading eyebrow="Decision support" title="Ask VANMITRA AI" subtitle="Query the Ozar register in English, Marathi or Hindi." actions={<Badge variant="outline" className="gap-2 border-forest/20 text-forest"><span className="size-2 rounded-full bg-forest" /> AI online</Badge>} />
      <div className="overflow-hidden rounded-lg border border-border bg-card panel-shadow">
        <div className="min-h-[420px] space-y-5 p-5 md:p-8">
          {messages.map((item, index) => (
            <div key={index} className={`flex gap-3 ${item.from === "user" ? "justify-end" : ""}`}>
              <div className={`max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${item.from === "user" ? "bg-forest text-primary-foreground" : "bg-secondary text-foreground"}`}>{item.text}</div>
            </div>
          ))}
        </div>
        <div className="border-t border-border bg-secondary/40 p-4">
          <div className="flex gap-2">
            <Input value={message} onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && message.trim()) { setMessages([...messages, { from: "user", text: message }, { from: "ai", text: message.toLowerCase().includes("324") ? `Survey No. 324 is the critical overlap cluster with ${surveySummaries[0].claimCount} linked claims and a 61% derived confidence score. It requires human review before Golden Record creation.` : `I found ${ozarDataset.totalClaims} source claims across ${ozarDataset.uniqueSurveys} survey numbers in the Ozar Village register. Ask me about a specific survey number for more detail.` }]); setMessage(""); } }}
              placeholder="Ask about Ozar claims..." />
            <Button onClick={() => { if (message.trim()) { setMessages([...messages, { from: "user", text: message }, { from: "ai", text: `I found ${ozarDataset.totalClaims} source claims across ${ozarDataset.uniqueSurveys} survey numbers. Ask specifically about Survey No. 324 for conflict analysis.` }]); setMessage(""); } }} className="bg-forest hover:bg-forest-deep" aria-label="Send question"><ArrowUpRight className="size-4" /></Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setMessage("Show overlapping claims on Survey No. 324")}>Show Survey No. 324</Button>
            <Button variant="outline" size="sm" onClick={() => setMessage("How many claims are in Ozar Village?")}>Count all claims</Button>
          </div>
        </div>
      </div>
    </div>
  );

  if (isReports) return (
    <div className="space-y-6">
      <PageHeading eyebrow="Outputs" title="Reports" subtitle="Generate traceable outputs for review committees and field teams." actions={<Button onClick={() => onNotice("Report generation started.")} className="gap-2 bg-forest hover:bg-forest-deep"><Play className="size-4" /> Generate report</Button>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {["Claim verification report","Conflict report · Survey 324","Dataset quality report","Harmonization report","Confidence analysis","Golden record report"].map((report) => (
          <div key={report} className="rounded-lg border border-border bg-card p-5 panel-shadow">
            <div className="mb-5 grid size-10 place-items-center rounded-lg bg-forest-soft text-forest"><FileText className="size-5" /></div>
            <h2 className="font-semibold text-forest-deep">{report}</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Ozar Village pilot · generated from the current harmonization workspace.</p>
            <div className="mt-5 flex gap-2">
              <Button size="sm" onClick={() => onNotice(`${report} is being generated.`)} className="bg-forest hover:bg-forest-deep">Generate</Button>
              <Button variant="outline" size="sm" onClick={() => onNotice("CSV export prepared.")}><ArrowDownToLine className="size-3" /> Export</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeading eyebrow={view === "Settings" ? "Workspace administration" : view === "Processing Center" ? "AI pipeline" : "Record operations"} title={view} subtitle={view === "Datasets" ? "Manage source registers and geospatial inputs for Ozar Village." : view === "Processing Center" ? "Track each stage from ingestion to Golden Land Record." : view === "Golden Records" ? "Review verified records produced by the harmonization workflow." : `Work through ${view.toLowerCase()} items with clear provenance and officer actions.`}
        actions={<><Button variant="outline" onClick={() => onNotice("Filters reset.")} className="gap-2"><Filter className="size-4" /> Filters</Button><Button onClick={() => onNotice(view === "Datasets" ? "Upload wizard opened." : "Action queued for officer review.")} className="gap-2 bg-forest hover:bg-forest-deep"><Plus className="size-4" /> {view === "Datasets" ? "Add dataset" : "New action"}</Button></>} />
      {view === "Processing Center" ? (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          <div className="rounded-lg border border-border bg-card p-5 panel-shadow">
            <div className="mb-6 flex items-center justify-between">
              <div><h2 className="font-display text-lg font-bold text-forest-deep">Run OZAR-2026-03</h2><p className="mt-1 text-xs text-muted-foreground">Started today · Survey No. 324 focus</p></div>
              <Badge className="border-signal/30 bg-signal-soft text-forest-deep">Processing</Badge>
            </div>
            <div className="space-y-1">
              {processingSteps.map((step, index) => (
                <div key={step.label} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`grid size-8 place-items-center rounded-full ${step.state === "Completed" ? "bg-forest text-primary-foreground" : step.state === "Processing" ? "bg-signal text-forest-deep" : "bg-secondary text-muted-foreground"}`}>
                      {step.state === "Completed" ? <Check className="size-4" /> : step.state === "Processing" ? <Activity className="size-4" /> : <span className="text-xs">{index + 1}</span>}
                    </div>
                    {index < processingSteps.length - 1 && <div className="h-9 w-px bg-border" />}
                  </div>
                  <div className="pb-5"><div className="text-sm font-semibold">{step.label}</div><div className="mt-1 text-xs text-muted-foreground">{step.detail} · {step.state}</div></div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-5 panel-shadow">
            <h2 className="font-display text-lg font-bold text-forest-deep">Run summary</h2>
            <div className="mt-5 space-y-3">
              <InfoRow label="Input records" value={String(ozarDataset.totalClaims)} />
              <InfoRow label="Survey groups" value={String(ozarDataset.uniqueSurveys)} />
              <InfoRow label="Critical cluster" value="Survey 324" />
              <InfoRow label="Geometry status" value="Illustrative" />
            </div>
            <div className="mt-6 rounded-md bg-secondary p-4 text-xs leading-relaxed text-muted-foreground">The pipeline keeps source attributes separate from derived confidence, status and conflict outputs.</div>
            <Button onClick={() => onNotice("Processing run paused.")} variant="outline" className="mt-5 w-full">Pause run</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card panel-shadow">
          <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
            <div className="relative max-w-sm flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by survey or status" className="pl-9" /></div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-forest" /> Live derived view</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-5 py-3 font-semibold">Survey / record</th><th className="px-5 py-3 font-semibold">Claims</th><th className="px-5 py-3 font-semibold">Confidence</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 text-right font-semibold">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((item) => (
                  <tr key={item.surveyNumber} className="transition-colors hover:bg-secondary/40">
                    <td className="px-5 py-4"><div className="font-semibold text-forest-deep">Survey No. {item.surveyNumber}</div><div className="mt-1 text-xs text-muted-foreground">{item.issue ?? "Ready for harmonization"}</div></td>
                    <td className="px-5 py-4 text-muted-foreground">{item.claimCount} linked</td>
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><span className="font-semibold">{item.confidence}%</span><div className="h-1.5 w-20 rounded-full bg-secondary"><div className={`h-full rounded-full ${item.confidence < 75 ? "bg-signal" : "bg-forest"}`} style={{ width: `${item.confidence}%` }} /></div></div></td>
                    <td className="px-5 py-4"><Badge className={statusClasses[item.status]}>{item.status}</Badge></td>
                    <td className="px-5 py-4 text-right"><Button variant="outline" size="sm" onClick={() => { onNavigate("Map Explorer"); onNotice(`Survey No. ${item.surveyNumber} opened on map.`); }}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No derived records match this filter.</div>}
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
            <span>Showing {filtered.length} derived survey groups · source register contains {ozarDataset.totalClaims} rows</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="size-7" aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
              <span>1 / 1</span>
              <Button variant="outline" size="icon" className="size-7" aria-label="Next page"><ChevronRight className="size-4" /></Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
