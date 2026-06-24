import { useState, useEffect, useCallback } from "react";
import {
  Lock, LogOut, RefreshCw, ChevronDown, ChevronUp, Trophy, Shield, Flame, List,
  History, BarChart2, HelpCircle, Plus, Check, AlertTriangle, Clock, Info, Activity,
  Eye, EyeOff, X, Ban, Sliders, User, TrendingUp,
} from "lucide-react";
import { api, auth, setUnauthorizedHandler } from "./api.js";

/* ============ thème ============ */
const C = {
  bg: "#0B0E14", surface: "#141925", surface2: "#1A2031", line: "rgba(232,230,223,0.10)",
  text: "#E8E6DF", muted: "#8A94A6", faint: "#5A6378",
  gold: "#E0A33E", teal: "#3FB7A6", warn: "#E08A3E", danger: "#D8584A", blue: "#5B8DEF", green: "#52C18A",
};
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

/* ============ helpers ============ */
const pct = (x, d = 1) => `${x >= 0 ? "" : ""}${(x * 100).toFixed(d)}%`;
const signPct = (x, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const fmtDT = (iso) => { try { return new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };
const fmtD = (iso) => { try { return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }); } catch { return ""; } };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* ============ App ============ */
export default function App() {
  const [token, setToken] = useState(auth.get());
  const [user, setUser] = useState(null);
  const [sub, setSub] = useState(null);
  const [booting, setBooting] = useState(true);

  const logout = useCallback(() => { auth.clear(); setToken(null); setUser(null); setSub(null); }, []);
  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (auth.get()) {
        try { const me = await api.get("/me"); if (alive) { setUser(me.user); setSub(me.subscription); } }
        catch { if (alive) logout(); }
      }
      if (alive) setBooting(false);
    })();
    return () => { alive = false; };
  }, [logout]);

  const onAuth = async (tok, usr) => { auth.set(tok); setToken(tok); setUser(usr); try { const me = await api.get("/me"); setSub(me.subscription); } catch {} };

  if (booting) return <Center><div style={{ color: C.muted }}>Chargement…</div></Center>;
  if (!token || !user) return <AuthScreen onAuth={onAuth} />;
  return <Main user={user} sub={sub} onLogout={logout} />;
}

function Center({ children }) {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>{children}</div>;
}

/* ============ Auth ============ */
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErr(""); setLoading(true);
    try {
      const res = mode === "login" ? await api.login(email.trim(), password) : await api.register(email.trim(), password);
      await onAuth(res.token, res.user);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  };

  return (
    <Center>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <Brand />
        <div style={{ marginTop: 28, fontSize: 15, fontWeight: 700 }}>{mode === "login" ? "Connexion" : "Créer un compte"}</div>
        <div style={{ marginTop: 14 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" autoCapitalize="none" autoCorrect="off" inputMode="email" style={input} />
        </div>
        <div style={{ position: "relative", marginTop: 10 }}>
          <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="mot de passe" style={input} />
          <button onClick={() => setShow((s) => !s)} style={eyeBtn}>{show ? <EyeOff size={16} color={C.faint} /> : <Eye size={16} color={C.faint} />}</button>
        </div>
        {mode === "register" && <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>8 caractères minimum.</div>}
        {err && <div style={{ color: C.danger, fontSize: 12, marginTop: 10 }}>{err}</div>}
        <button onClick={submit} disabled={loading || !email || !password} style={{ ...primary, marginTop: 16, opacity: loading || !email || !password ? 0.6 : 1 }}>
          {loading ? "…" : mode === "login" ? "Se connecter" : "Créer le compte"}
        </button>
        <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }} style={{ ...textBtn, marginTop: 14, width: "100%", justifyContent: "center" }}>
          {mode === "login" ? "Pas de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
        </button>
        <div style={{ marginTop: 22, fontSize: 11, color: C.faint, lineHeight: 1.5, textAlign: "center" }}>Pariez avec modération · 09 74 75 13 13</div>
      </div>
    </Center>
  );
}
function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: C.surface, display: "grid", placeItems: "center", border: `1px solid ${C.line}` }}><TrendingUp size={20} color={C.gold} /></div>
      <div><div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}>Pronos IA</div><div style={{ fontSize: 11, color: C.faint, fontFamily: mono }}>analyse · qualité avant quantité</div></div>
    </div>
  );
}

/* ============ Main ============ */
function Main({ user, sub, onLogout }) {
  const [tab, setTab] = useState("pronos");
  const [menu, setMenu] = useState(false);
  const [stake, setStake] = useState(() => Number(localStorage.getItem("pronos_stake") || 1));
  const setStakePersist = (v) => { const n = Math.max(0.1, Number(v) || 1); setStake(n); localStorage.setItem("pronos_stake", String(n)); };

  return (
    <div style={{ minHeight: "100vh", background: C.bg }} className="safe-bottom">
      <TopBar title={tabTitle(tab)} onMenu={() => setMenu(true)} />
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {tab === "pronos" && <Predictions stake={stake} />}
        {tab === "historique" && <HistoryScreen />}
        {tab === "dashboard" && <Dashboard />}
        {tab === "aide" && <Help />}
      </div>
      <BottomNav tab={tab} setTab={setTab} />
      {menu && <AccountSheet user={user} sub={sub} stake={stake} setStake={setStakePersist} onClose={() => setMenu(false)} onLogout={onLogout} />}
    </div>
  );
}
const tabTitle = (t) => ({ pronos: "Pronostics", historique: "Historique", dashboard: "Tableau de bord", aide: "Aide" }[t]);

function TopBar({ title, onMenu }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 5, background: "rgba(11,14,20,0.85)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.line}`, paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, fontSize: 17, fontWeight: 700, letterSpacing: -0.3, display: "flex", alignItems: "center", gap: 8 }}>{title}<span style={{ width: 6, height: 6, borderRadius: 6, background: C.teal }} /></div>
        <button onClick={onMenu} style={ghost}><User size={18} color={C.text} /></button>
      </div>
    </div>
  );
}

function BottomNav({ tab, setTab }) {
  const items = [
    { id: "pronos", label: "Pronos", icon: TrendingUp },
    { id: "historique", label: "Historique", icon: History },
    { id: "dashboard", label: "Stats", icon: BarChart2 },
    { id: "aide", label: "Aide", icon: HelpCircle },
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 8, background: "rgba(11,14,20,0.92)", backdropFilter: "blur(12px)", borderTop: `1px solid ${C.line}` }} className="nav-safe">
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex" }}>
        {items.map(({ id, label, icon: Icon }) => {
          const on = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: "10px 0 9px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <Icon size={20} color={on ? C.gold : C.faint} />
              <span style={{ fontSize: 10, color: on ? C.gold : C.faint, fontWeight: on ? 700 : 500 }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============ Pronostics ============ */
const PERIODS = [{ id: "today", label: "Aujourd'hui" }, { id: "tomorrow", label: "Demain" }, { id: "3d", label: "3 jours" }, { id: "7d", label: "7 jours" }];
const VIEWS = [
  { id: "top", label: "Top 5", icon: Trophy },
  { id: "safe", label: "Plus sûrs", icon: Shield },
  { id: "value", label: "Forte valeur", icon: Flame },
  { id: "all", label: "Tous", icon: List },
];

function Predictions({ stake }) {
  const [period, setPeriod] = useState("today");
  const [view, setView] = useState("top");
  const [minConf, setMinConf] = useState(0);
  const [items, setItems] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [showRejected, setShowRejected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [followed, setFollowed] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const data = await api.get(`/predictions?period=${period}&view=${view}&limit=100`);
      setItems(data);
      if (showRejected) {
        const j = await api.get("/predictions/journal?includeRejected=true&limit=200");
        setRejected(j.filter((x) => !x.proposed && new Date(x.match.commence) > new Date()));
      }
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [period, view, showRejected]);
  useEffect(() => { load(); }, [load]);

  const follow = async (p) => {
    try { await api.post("/bets", { predictionId: p.id, stake }); setFollowed((s) => new Set(s).add(p.id)); }
    catch (e) { setErr(e.message); }
  };

  const list = items.filter((x) => x.confidence >= minConf);

  return (
    <div style={{ padding: "0 16px 24px" }}>
      <Pills options={PERIODS} value={period} onChange={setPeriod} />
      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 0 8px" }}>
        {VIEWS.map((v) => { const on = view === v.id; const I = v.icon; return (
          <button key={v.id} onClick={() => setView(v.id)} style={{ ...pill, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, background: on ? C.surface2 : "transparent", color: on ? C.text : C.faint, borderColor: on ? C.line : "transparent", fontWeight: on ? 700 : 500 }}><I size={13} />{v.label}</button>
        ); })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 2px 10px" }}>
        <Sliders size={13} color={C.faint} />
        <span style={{ fontSize: 11, color: C.faint, fontFamily: mono, whiteSpace: "nowrap" }}>conf. min {minConf}</span>
        <input type="range" min="0" max="85" value={minConf} onChange={(e) => setMinConf(+e.target.value)} style={{ flex: 1 }} />
        <button onClick={load} disabled={loading} style={ghost}><RefreshCw size={16} color={C.text} className={loading ? "spin" : ""} /></button>
      </div>

      {err && <Banner text={err} />}
      {loading && items.length === 0 && <Note icon={<Activity size={14} color={C.blue} />} text="Chargement des pronostics validés…" />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontFamily: mono, margin: "4px 0 8px" }}>
        <span style={{ color: C.teal }}>{list.length} validé(s)</span>
        <button onClick={() => setShowRejected((s) => !s)} style={{ ...textBtn, color: C.faint }}>écartés {showRejected ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
      </div>

      {showRejected && (
        <div style={{ marginBottom: 14, background: "rgba(138,148,166,0.06)", border: `1px dashed ${C.line}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><Ban size={12} /> Refusés automatiquement — qualité avant quantité</div>
          {rejected.length === 0 ? <div style={{ fontSize: 12, color: C.faint }}>Aucun match écarté à venir.</div> :
            rejected.slice(0, 30).map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: 12, borderTop: `1px solid ${C.line}` }}>
                <span style={{ color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.match.home} vs {m.match.away}</span>
                <span style={{ color: C.warn, flexShrink: 0, fontSize: 11 }}>{(m.rejectReasons && m.rejectReasons[0]) || "écarté"}</span>
              </div>
            ))}
        </div>
      )}

      {!loading && list.length === 0 && (
        <div style={{ marginTop: 20, textAlign: "center", padding: 24, border: `1px dashed ${C.line}`, borderRadius: 14 }}>
          <Shield size={26} color={C.teal} />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10 }}>Aucun pari validé pour le moment</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>C'est normal et voulu : le système refuse les paris trop incertains. Changez de période, ou laissez les jobs collecter plus de données.</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {list.map((p, i) => <PredCard key={p.id} p={p} rank={view === "top" ? i + 1 : null} onFollow={() => follow(p)} followed={followed.has(p.id)} />)}
      </div>
      <Disclaimer />
    </div>
  );
}

function PredCard({ p, rank, onFollow, followed }) {
  const [open, setOpen] = useState(false);
  const ev = p.basis === "IA" ? p.evSubjective : p.evObjective;
  const gap = p.estProb - p.impliedProb;
  return (
    <div style={{ background: C.surface, border: `1px solid ${rank ? "rgba(224,163,62,0.35)" : C.line}`, borderRadius: 14, overflow: "hidden" }}>
      {rank && <div style={{ height: 3, background: `linear-gradient(90deg, ${C.gold}, transparent)` }} />}
      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.faint, fontFamily: mono, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>{rank && <span style={{ color: C.gold, fontWeight: 700 }}>#{rank}</span>}<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.match.league}</span></div>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{p.match.home} <span style={{ color: C.faint, fontWeight: 400 }}>vs</span> {p.match.away}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <Status status={p.match.status} />
              <span style={{ fontSize: 11, color: C.muted, fontFamily: mono, display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={11} /> {fmtDT(p.match.commence)}</span>
              <span style={{ fontSize: 10, color: C.faint, fontFamily: mono }}>fiab. {p.reliability}</span>
            </div>
          </div>
          <Gauge value={p.confidence} />
        </div>

        <div style={{ height: 1, background: C.line, margin: "12px 0" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>Sélection</div>
            <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.pick}</div>
          </div>
          <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700 }}>{p.odds.toFixed(2)}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
          <Stat label="Value" value={ev > 0 ? "Oui" : "Non"} color={ev > 0 ? C.teal : C.faint} />
          <Stat label="EV" value={signPct(ev)} color={ev > 0 ? C.teal : C.danger} />
          <Stat label="Risque" value={p.risk} color={p.risk === "faible" ? C.teal : p.risk === "moyen" ? C.gold : C.danger} />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button onClick={() => setOpen((o) => !o)} style={{ ...textBtn, flex: 1, justifyContent: "flex-start" }}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? "Masquer" : "Détail"}</button>
          <button onClick={onFollow} disabled={followed} style={{ ...followBtn, opacity: followed ? 0.6 : 1, color: followed ? C.teal : C.text }}>{followed ? <><Check size={14} /> Suivi</> : <><Plus size={14} /> Suivre</>}</button>
        </div>

        {open && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Tile label="Prob. estimée" sub={p.basis} value={pct(p.estProb)} />
              <Tile label="Prob. implicite" value={pct(p.impliedProb)} />
              <Tile label="Écart" value={signPct(gap)} color={gap > 0 ? C.teal : C.danger} />
              <Tile label="Prob. juste (marché)" value={pct(p.fairProb)} />
              <Tile label="EV objectif" value={signPct(p.evObjective)} color={p.evObjective > 0 ? C.teal : C.danger} />
              <Tile label="EV subjectif (IA)" value={signPct(p.evSubjective)} color={p.evSubjective > 0 ? C.teal : C.danger} />
              <Tile label="Confiance" value={`${p.confidence}/100`} />
              <Tile label="Fiabilité" value={`${p.reliability}/100`} />
              {p.clvPct != null && <Tile label="CLV" value={signPct(p.clvPct)} color={p.clvPct > 0 ? C.green : C.danger} />}
              {p.result && <Tile label="Résultat" value={p.result} color={p.result === "gagné" ? C.green : p.result === "perdu" ? C.danger : C.muted} />}
            </div>
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.55, color: C.muted }}>
              {p.recommendation && <div style={{ marginBottom: 8, fontSize: 12, color: C.text }}>Avis : <b style={{ color: p.recommendation === "à jouer" ? C.teal : p.recommendation === "à éviter" ? C.danger : C.gold }}>{p.recommendation}</b></div>}
              {p.rationale ? <p style={{ margin: "0 0 10px" }}>{p.rationale}</p> : <p style={{ margin: 0, color: C.faint, fontStyle: "italic" }}>Analyse fondée sur les cotes réelles (consensus de marché).</p>}
              {p.keyFactors && p.keyFactors.length > 0 && <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>{p.keyFactors.map((f, i) => <li key={i} style={{ marginBottom: 4 }}>{f}</li>)}</ul>}
              {p.dataGaps && p.dataGaps.length > 0 && <div style={{ fontSize: 12, color: C.warn }}>Manque : {p.dataGaps.join(", ")}.</div>}
            </div>
            <div style={{ fontSize: 10, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>EV et rentabilité supposent la probabilité estimée correcte — indicatif, jamais garanti.</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ Historique ============ */
function HistoryScreen() {
  const [bets, setBets] = useState([]);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { const [b, d] = await Promise.all([api.get("/bets"), api.get("/dashboard")]); setBets(b); setDash(d); }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const settle = async (id, status) => { try { await api.patch(`/bets/${id}`, { status }); load(); } catch (e) { setErr(e.message); } };
  const g = dash?.global;

  return (
    <div style={{ padding: "12px 16px 24px" }}>
      {err && <Banner text={err} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <Big label="ROI" value={g ? signPct(g.roi) : "—"} color={g && g.roi > 0 ? C.green : g && g.roi < 0 ? C.danger : C.muted} />
        <Big label="Réussite" value={g ? `${Math.round(g.hitRate * 100)}%` : "—"} sub={g ? `${g.wins}/${g.settled}` : ""} />
        <Big label="Profit" value={g ? `${g.profit >= 0 ? "+" : ""}${g.profit.toFixed(1)}u` : "—"} color={g && g.profit > 0 ? C.green : g && g.profit < 0 ? C.danger : C.muted} />
      </div>
      <div style={{ fontSize: 11, color: C.faint, fontFamily: mono, marginTop: 8, textAlign: "center" }}>{g ? `${g.bets} paris · ${g.pending} en attente · ${g.settled} réglés` : ""}</div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
        <button onClick={load} disabled={loading} style={{ ...primary, opacity: loading ? 0.6 : 1 }}><RefreshCw size={15} className={loading ? "spin" : ""} style={{ marginRight: 6, verticalAlign: "middle" }} />Rafraîchir</button>
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>Les résultats et le CLV se règlent automatiquement côté serveur. Le bouton ci-dessus recharge les données.</div>

      <div style={{ marginTop: 18, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Paris suivis</div>
      {bets.length === 0 && !loading ? (
        <div style={{ textAlign: "center", padding: 28, border: `1px dashed ${C.line}`, borderRadius: 14, color: C.muted, fontSize: 13 }}>Aucun pari suivi. Touchez « Suivre » sur un pronostic.</div>
      ) : bets.map((b) => <BetRow key={b.id} b={b} onSettle={settle} />)}
      <Disclaimer />
    </div>
  );
}

function BetRow({ b, onSettle }) {
  const map = { en_attente: { c: C.gold, t: "En attente" }, "gagné": { c: C.green, t: "Gagné" }, "perdu": { c: C.danger, t: "Perdu" }, "annulé": { c: C.faint, t: "Annulé" } };
  const s = map[b.status] || map.en_attente;
  const profit = Number(b.profit);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.faint, fontFamily: mono }}>{b.league} · {fmtD(b.commence_time)}</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.home_team} vs {b.away_team}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{b.pick_outcome} <span style={{ color: C.faint, fontFamily: mono }}>@ {Number(b.odds_taken).toFixed(2)} · {Number(b.stake)}u</span></div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: s.c, border: `1px solid ${s.c}`, padding: "2px 7px", borderRadius: 6, textTransform: "uppercase" }}>{s.t}</span>
          {(b.status === "gagné" || b.status === "perdu") && <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, marginTop: 6, color: profit >= 0 ? C.green : C.danger }}>{profit >= 0 ? "+" : ""}{profit.toFixed(2)}u</div>}
          {b.clv_pct != null && <div style={{ fontSize: 10, color: Number(b.clv_pct) >= 0 ? C.green : C.danger, fontFamily: mono }}>CLV {signPct(Number(b.clv_pct))}</div>}
        </div>
      </div>
      {b.result_score && <div style={{ fontSize: 11, color: C.muted, fontFamily: mono, marginTop: 6 }}>{b.result_score}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        {b.status === "en_attente" ? (
          <>
            <button onClick={() => onSettle(b.id, "gagné")} style={{ ...mini, color: C.green, borderColor: C.green + "55" }}>Gagné</button>
            <button onClick={() => onSettle(b.id, "perdu")} style={{ ...mini, color: C.danger, borderColor: C.danger + "55" }}>Perdu</button>
            <button onClick={() => onSettle(b.id, "annulé")} style={{ ...mini, color: C.faint }}>Annulé</button>
          </>
        ) : <button onClick={() => onSettle(b.id, "en_attente")} style={{ ...mini, color: C.muted }}>Rouvrir</button>}
      </div>
    </div>
  );
}

/* ============ Dashboard ============ */
function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { setD(await api.get("/dashboard")); } catch (e) { setErr(e.message); } finally { setLoading(false); } })(); }, []);

  if (loading) return <div style={{ padding: 24, color: C.muted }}>Chargement…</div>;
  if (err) return <div style={{ padding: 16 }}><Banner text={err} /></div>;
  const g = d.global;

  return (
    <div style={{ padding: "12px 16px 24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <Big label="ROI" value={signPct(g.roi)} color={g.roi > 0 ? C.green : g.roi < 0 ? C.danger : C.muted} />
        <Big label="Réussite" value={`${Math.round(g.hitRate * 100)}%`} sub={`${g.wins}/${g.settled}`} />
        <Big label="Profit" value={`${g.profit >= 0 ? "+" : ""}${g.profit.toFixed(1)}u`} color={g.profit > 0 ? C.green : g.profit < 0 ? C.danger : C.muted} />
      </div>

      {/* CLV — indicateur principal */}
      <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}><TrendingUp size={15} color={C.gold} /> CLV — qualité du modèle</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <Tile label="CLV moyen (modèle)" value={d.clv.model.avgPct != null ? signPct(d.clv.model.avgPct) : "—"} sub={`${d.clv.model.n} préd.`} color={d.clv.model.avgPct > 0 ? C.green : d.clv.model.avgPct < 0 ? C.danger : C.muted} />
          <Tile label="CLV moyen (paris)" value={d.clv.bets.avgPct != null ? signPct(d.clv.bets.avgPct) : "—"} sub={`${d.clv.bets.n} paris`} color={d.clv.bets.avgPct > 0 ? C.green : d.clv.bets.avgPct < 0 ? C.danger : C.muted} />
        </div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>{d.clv.note}</div>
      </div>

      {/* bankroll */}
      <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Bankroll</div>
          <div style={{ fontSize: 11, color: C.faint, fontFamily: mono }}>drawdown max −{d.maxDrawdown}u</div>
        </div>
        <Spark points={d.bankrollCurve.map((p) => p.bankroll)} start={d.startBankroll} />
        <div style={{ fontSize: 11, color: C.faint, fontFamily: mono }}>départ {d.startBankroll}u · actuel {(d.bankrollCurve.at(-1)?.bankroll ?? d.startBankroll).toFixed(1)}u</div>
      </div>

      <Breakdown title="ROI par sport" rows={d.bySport} />
      <Breakdown title="ROI par championnat" rows={d.byLeague} />
      <Breakdown title="ROI par type de pari" rows={d.byMarket} />

      {d.monthly.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Évolution mensuelle</div>
          {d.monthly.map((m) => (
            <Row key={m.period} left={m.period} right={`${m.profit >= 0 ? "+" : ""}${m.profit.toFixed(1)}u`} rightColor={m.profit >= 0 ? C.green : C.danger} sub={`${m.n} paris · ROI ${signPct(m.roi)}`} />
          ))}
        </div>
      )}
      <Disclaimer />
    </div>
  );
}

function Breakdown({ title, rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {rows.map((r) => (
        <Row key={r.key} left={r.key} right={signPct(r.roi)} rightColor={r.roi > 0 ? C.green : r.roi < 0 ? C.danger : C.muted} sub={`${r.n} paris · ${Math.round(r.hit * 100)}% · ${r.profit >= 0 ? "+" : ""}${r.profit.toFixed(1)}u`} />
      ))}
    </div>
  );
}
function Row({ left, right, rightColor, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
      <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{left}</div><div style={{ fontSize: 11, color: C.faint, fontFamily: mono }}>{sub}</div></div>
      <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: rightColor, flexShrink: 0, marginLeft: 10 }}>{right}</div>
    </div>
  );
}
function Spark({ points, start }) {
  const w = 280, h = 56;
  if (!points || points.length < 2) return <div style={{ height: h, display: "grid", placeItems: "center", color: C.faint, fontSize: 12 }}>Pas encore d'historique réglé.</div>;
  const min = Math.min(...points, start), max = Math.max(...points, start);
  const rng = max - min || 1;
  const step = w / (points.length - 1);
  const pts = points.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / rng) * h).toFixed(1)}`).join(" ");
  const up = points.at(-1) >= start;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ margin: "10px 0" }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? C.green : C.danger} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ============ Aide ============ */
function Help() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { (async () => {
    try {
      const [quickstart, faq, glossary, manual, tutorial] = await Promise.all([
        api.get("/help/quickstart"), api.get("/help/faq"), api.get("/help/glossary"), api.get("/help/manual"), api.get("/help/tutorial"),
      ]);
      setData({ quickstart, faq, glossary, manual, tutorial });
    } catch (e) { setErr(e.message); }
  })(); }, []);

  if (err) return <div style={{ padding: 16 }}><Banner text={err} /></div>;
  if (!data) return <div style={{ padding: 24, color: C.muted }}>Chargement…</div>;

  return (
    <div style={{ padding: "12px 16px 24px" }}>
      <Accordion title="Démarrage rapide" defaultOpen>
        {data.quickstart.map((s) => <div key={s.step} style={{ padding: "8px 0", borderTop: `1px solid ${C.line}` }}><div style={{ fontSize: 13, fontWeight: 700 }}>{s.step}. {s.title}</div><div style={{ fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{s.body}</div></div>)}
      </Accordion>
      <Accordion title="Manuel">
        {data.manual.sections.map((s, i) => <div key={i} style={{ padding: "8px 0", borderTop: `1px solid ${C.line}` }}><div style={{ fontSize: 13, fontWeight: 700 }}>{s.h}</div><div style={{ fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{s.t}</div></div>)}
      </Accordion>
      <Accordion title="FAQ">
        {data.faq.map((f, i) => <div key={i} style={{ padding: "8px 0", borderTop: `1px solid ${C.line}` }}><div style={{ fontSize: 13, fontWeight: 700 }}>{f.q}</div><div style={{ fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{f.a}</div></div>)}
      </Accordion>
      <Accordion title="Glossaire">
        {data.glossary.map((gl, i) => <div key={i} style={{ padding: "8px 0", borderTop: `1px solid ${C.line}` }}><div style={{ fontSize: 13, fontWeight: 700 }}>{gl.term}</div><div style={{ fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{gl.def}</div></div>)}
      </Accordion>
      <Disclaimer />
    </div>
  );
}
function Accordion({ title, children, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, marginBottom: 12, overflow: "hidden" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", background: "none", border: "none", color: C.text, cursor: "pointer", padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, fontWeight: 700 }}>
        {title}{open ? <ChevronUp size={16} color={C.faint} /> : <ChevronDown size={16} color={C.faint} />}
      </button>
      {open && <div style={{ padding: "0 14px 12px" }}>{children}</div>}
    </div>
  );
}

/* ============ Account ============ */
function AccountSheet({ user, sub, stake, setStake, onClose, onLogout }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 20, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, background: C.bg, borderTop: `1px solid ${C.line}`, borderRadius: "18px 18px 0 0", padding: 18, paddingBottom: "calc(18px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Compte</div>
          <button onClick={onClose} style={ghost}><X size={18} color={C.text} /></button>
        </div>
        <div style={{ fontSize: 13, color: C.muted }}>{user.email || "compte"}</div>
        <div style={{ fontSize: 12, color: C.faint, fontFamily: mono, marginTop: 4 }}>plan : {sub?.plan || "free"} · {sub?.status || "active"}</div>

        <div style={{ marginTop: 18, fontSize: 13, fontWeight: 600 }}>Mise par défaut (unités)</div>
        <div style={{ fontSize: 11, color: C.faint, marginBottom: 8 }}>Appliquée quand vous suivez un pari.</div>
        <input type="number" min="0.1" step="0.1" value={stake} onChange={(e) => setStake(e.target.value)} style={input} />

        <div style={{ marginTop: 14, fontSize: 11, color: C.faint, fontFamily: mono }}>API : {api.base}</div>

        <button onClick={onLogout} style={{ ...primary, marginTop: 18, background: "transparent", color: C.danger, border: `1px solid ${C.danger}66` }}><LogOut size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />Se déconnecter</button>
      </div>
    </div>
  );
}

/* ============ petits composants ============ */
function Pills({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 0 6px" }}>
      {options.map((o) => { const on = value === o.id; return (
        <button key={o.id} onClick={() => onChange(o.id)} style={{ ...pill, background: on ? C.gold : C.surface, color: on ? "#1a1407" : C.muted, borderColor: on ? C.gold : C.line, fontWeight: on ? 700 : 500 }}>{o.label}</button>
      ); })}
    </div>
  );
}
function Stat({ label, value, color }) {
  return (
    <div style={{ background: C.surface2, borderRadius: 9, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, color: C.faint, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || C.text, fontFamily: mono, textTransform: "capitalize" }}>{value}</div>
    </div>
  );
}
function Tile({ label, sub, value, color }) {
  return (
    <div style={{ background: C.surface2, borderRadius: 9, padding: "9px 11px" }}>
      <div style={{ fontSize: 10, color: C.faint }}>{label}{sub && <span style={{ opacity: 0.7 }}> · {sub}</span>}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || C.text, fontFamily: mono, marginTop: 2, textTransform: "capitalize" }}>{value}</div>
    </div>
  );
}
function Big({ label, value, sub, color }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 8px", textAlign: "center" }}>
      <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text, fontFamily: mono, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.faint, fontFamily: mono }}>{sub}</div>}
    </div>
  );
}
function Gauge({ value }) {
  const v = clamp(value, 0, 100), r = 20, c = 2 * Math.PI * r;
  const col = v >= 65 ? C.teal : v >= 45 ? C.gold : C.warn;
  return (
    <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
      <svg width="52" height="52" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="26" cy="26" r={r} fill="none" stroke={C.surface2} strokeWidth="5" />
        <circle cx="26" cy="26" r={r} fill="none" stroke={col} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (v / 100) * c} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}><div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: col, lineHeight: 1 }}>{Math.round(v)}</div><div style={{ fontSize: 7, color: C.faint, letterSpacing: 0.5 }}>CONF.</div></div>
      </div>
    </div>
  );
}
function Status({ status }) {
  const map = { "programmé": { c: C.teal, t: "Programmé" }, "en direct": { c: C.danger, t: "En direct" }, "terminé": { c: C.faint, t: "Terminé" } };
  const s = map[status] || { c: C.warn, t: status || "—" };
  return <span style={{ fontSize: 10, fontWeight: 700, color: s.c, border: `1px solid ${s.c}`, padding: "2px 7px", borderRadius: 6, letterSpacing: 0.3, textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 5, height: 5, borderRadius: 5, background: s.c }} />{s.t}</span>;
}
function Note({ icon, text }) { return <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px", fontSize: 12, color: C.muted, marginTop: 8 }}>{icon}{text}</div>; }
function Banner({ text }) { return <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "rgba(216,88,74,0.10)", border: "1px solid rgba(216,88,74,0.3)", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#f0a89f", marginTop: 8, marginBottom: 8, lineHeight: 1.5 }}><AlertTriangle size={15} color={C.danger} style={{ flexShrink: 0, marginTop: 1 }} />{text}</div>; }
function Disclaimer() {
  return (
    <div style={{ marginTop: 24, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><Info size={12} /> Cotes de bookmakers réels en référence de marché. Aucun pronostic ne garantit un résultat.</div>
      <div>Pariez avec modération — Joueurs Info Service : <span style={{ fontFamily: mono }}>09 74 75 13 13</span>.</div>
    </div>
  );
}

/* ============ styles ============ */
const input = { width: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", color: C.text, fontSize: 16, fontFamily: mono, outline: "none" };
const eyeBtn = { position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4 };
const primary = { background: C.gold, color: "#1a1407", border: "none", borderRadius: 11, padding: "13px 18px", fontSize: 15, fontWeight: 700, cursor: "pointer", width: "100%" };
const ghost = { background: "transparent", border: `1px solid ${C.line}`, borderRadius: 10, width: 38, height: 38, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 };
const textBtn = { background: "none", border: "none", color: C.blue, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, padding: 0 };
const followBtn = { border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, background: C.surface };
const mini = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };
const pill = { border: `1px solid ${C.line}`, borderRadius: 999, padding: "7px 14px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" };
