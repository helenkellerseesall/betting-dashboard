import { useEffect, useState } from "react"
import "./workstation.css"
import { api } from "./api"
import type { SportState, Sport } from "./types"
import { BuilderProvider } from "./builderContext"
import { Dashboard } from "./sections/Dashboard"
import { SlateBrowser } from "./sections/SlateBrowser"
import { AiSlipsView } from "./sections/AiSlipsView"
import { LineShoppingView } from "./sections/LineShoppingView"
import { PortfolioView } from "./sections/PortfolioView"
import { BetBuilderDock, BetBuilderView } from "./sections/BetBuilderView"
import { FirstBasketView } from "./sections/FirstBasketView"
import { ProcessReviewView } from "./sections/ProcessReviewView"

type SectionId = "dashboard" | "slate" | "slips" | "shopping" | "portfolio" | "builder" | "fb" | "review"

const NAV: { id: SectionId; label: string; icon: string }[] = [
  { id: "dashboard", label: "Tonight's Edge",  icon: "⚡" },
  { id: "slate",     label: "Full Slate",       icon: "🎯" },
  { id: "slips",     label: "AI Parlays",       icon: "🎲" },
  { id: "shopping",  label: "Book Radar",       icon: "👁️" },
  { id: "portfolio", label: "Risk Map",         icon: "📐" },
  { id: "builder",   label: "Bet Builder",      icon: "🛠️" },
  { id: "fb",        label: "First Basket",     icon: "🏀" },
  { id: "review",    label: "Edge Log",         icon: "📈" },
]

export function Workstation() {
  const [sport, setSport] = useState<Sport>(() => {
    const stored = (typeof window !== "undefined" && window.localStorage.getItem("ws.sport")) as Sport | null
    return stored === "nba" ? "nba" : "mlb"
  })
  const [section, setSection] = useState<SectionId>("dashboard")
  const [state, setState] = useState<SportState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("ws.sport", sport)
    let cancelled = false
    setLoading(true)
    setError(null)
    setState(null)
    api.state(sport)
      .then((s) => { if (!cancelled) setState(s) })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sport])

  function refresh() {
    setLoading(true)
    setError(null)
    api.state(sport)
      .then(setState)
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
  }

  return (
    <BuilderProvider>
      <div className="ws-app">
        <div className="ws-header">
          <span className="ws-header-brand"><span>◉</span> EDGE ROOM</span>
          <span className="ws-dim" style={{ fontSize: 12 }}>{state ? `${state.sport.toUpperCase()} · ${state.date}` : ""}</span>
          <div className="ws-header-controls">
            <span className="ws-pill" style={{ pointerEvents: "none" }}>
              {state ? `${state.counts.candidates} plays` : (loading ? "loading…" : "—")}
            </span>
            <button className={`ws-pill ${sport === "mlb" ? "active" : ""}`} onClick={() => setSport("mlb")}>MLB</button>
            <button className={`ws-pill ${sport === "nba" ? "active" : ""}`} onClick={() => setSport("nba")}>NBA</button>
            <button className="ws-pill" onClick={refresh}>↻ Refresh</button>
          </div>
        </div>

        <nav className="ws-sidebar">
          {NAV.map((n) => (
            <button key={n.id} className={`ws-nav-btn ${section === n.id ? "active" : ""}`} onClick={() => setSection(n.id)}>
              <span className="ws-nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
          <div style={{ marginTop: "auto", padding: "8px 12px" }}>
            <a className="ws-link" href="?legacy=1">↗ Open legacy dashboard</a>
          </div>
        </nav>

        <main className="ws-main">
          {error && <div className="ws-card" style={{ borderLeft: "3px solid var(--ws-negative)", marginBottom: 12 }}>
            <strong style={{ color: "var(--ws-negative)" }}>Backend unreachable:</strong> {error}
            <div className="ws-dim" style={{ fontSize: 12, marginTop: 6 }}>Make sure the backend server is running on http://localhost:4000.</div>
          </div>}

          {section === "builder" ? (
            <BetBuilderView />
          ) : (
            <div className="ws-grid" style={{ gridTemplateColumns: "1fr 320px", alignItems: "start" }}>
              <div>
                {section === "dashboard" && <Dashboard state={state} />}
                {section === "slate"     && <SlateBrowser state={state} />}
                {section === "slips"     && <AiSlipsView state={state} />}
                {section === "shopping"  && <LineShoppingView state={state} />}
                {section === "portfolio" && <PortfolioView state={state} />}
                {section === "fb"        && <FirstBasketView state={state} />}
                {section === "review"    && <ProcessReviewView />}
              </div>
              <BetBuilderDock />
            </div>
          )}
        </main>
      </div>
    </BuilderProvider>
  )
}
