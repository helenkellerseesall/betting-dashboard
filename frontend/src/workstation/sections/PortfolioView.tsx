import { useMemo } from "react"
import type { SportState } from "../types"

interface BarSeg { label: string; value: number; color: string }
function StackedBar({ segs }: { segs: BarSeg[] }) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div className="ws-bar">
      {segs.map((s) => (
        <div
          key={s.label}
          className="ws-bar-seg"
          style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          title={`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}
        />
      ))}
    </div>
  )
}

export function PortfolioView({ state }: { state: SportState | null }) {
  const portfolio = state?.portfolio
  const candidates = state?.candidates || []
  const exposure = portfolio?.exposureMap

  const stacked = useMemo<BarSeg[]>(() => {
    const v = exposure?.byVolatility || { safe: 0, balanced: 0, aggressive: 0, lotto: 0 }
    return [
      { label: "safe",       value: v.safe || 0,       color: "var(--ws-vol-safe)" },
      { label: "balanced",   value: v.balanced || 0,   color: "var(--ws-vol-balanced)" },
      { label: "aggressive", value: v.aggressive || 0, color: "var(--ws-vol-aggressive)" },
      { label: "lotto",      value: v.lotto || 0,      color: "var(--ws-vol-lotto)" },
    ]
  }, [exposure])

  const topGames = useMemo(() => {
    const obj = exposure?.byGame || {}
    return Object.entries(obj as any)
      .map(([k, v]: any) => ({ k, ...(v as any) }))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 6)
  }, [exposure])

  const topPlayers = useMemo(() => {
    const obj = exposure?.byPlayer || {}
    return Object.entries(obj as any)
      .map(([k, v]: any) => ({ k, ...(v as any) }))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 8)
  }, [exposure])

  const topStats = useMemo(() => {
    const obj = exposure?.byStat || {}
    return Object.entries(obj as any)
      .map(([k, v]: any) => ({ k, ...(v as any) }))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 8)
  }, [exposure])

  if (!state) return <div className="ws-empty">Loading…</div>
  const ringPct = Math.max(0, Math.min(100, portfolio?.score ?? 0))
  // Match the softened grading: green at 72+, blue at 60+, amber below.
  const ringColor = ringPct >= 72 ? "var(--ws-positive)" : ringPct >= 60 ? "var(--ws-info)" : "var(--ws-warn)"
  const moodTone = portfolio?.mood?.tone || "neutral"
  const moodHeadline = portfolio?.mood?.headline || (portfolio?.grade ?? "Portfolio")

  return (
    <div>
      <h2 className="ws-section-title">
        Portfolio <small>{candidates.length} candidates</small>
      </h2>

      <div className="ws-grid ws-grid-3" style={{ marginBottom: 14 }}>
        <div className="ws-card">
          <div className="ws-row-between" style={{ marginBottom: 12 }}>
            <strong>Score</strong>
            <span className={`ws-mood-pill ${moodTone}`}>● {moodHeadline}</span>
          </div>
          <div className="ws-row" style={{ gap: 14 }}>
            <div className="ws-score-ring" style={{ ["--ring-pct" as any]: ringPct, ["--ring-color" as any]: ringColor }}>
              {portfolio?.score ?? 0}
            </div>
            <div className="ws-stack" style={{ flex: 1 }}>
              <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Volatility Mix</div>
              <StackedBar segs={stacked} />
              <div className="ws-row" style={{ flexWrap: "wrap", gap: 8, fontSize: 11 }}>
                {stacked.map((s) => (
                  <span key={s.label}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 4 }}/>{s.label} {s.value}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="ws-card">
          <strong>Game Concentration</strong>
          <div className="ws-stack" style={{ marginTop: 8 }}>
            {topGames.length === 0 && <div className="ws-empty">No game exposure yet.</div>}
            {topGames.map((g: any) => (
              <div key={g.k} className="ws-row-between" style={{ fontFamily: "var(--ws-mono)", fontSize: 12 }}>
                <span className="ws-dim" style={{ flex: 1 }}>{g.matchup || g.k}</span>
                <span className="ws-text-strong">{g.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ws-card">
          <strong>Player Concentration</strong>
          <div className="ws-stack" style={{ marginTop: 8 }}>
            {topPlayers.length === 0 && <div className="ws-empty">No player exposure yet.</div>}
            {topPlayers.map((p: any) => (
              <div key={p.k} className="ws-row-between" style={{ fontFamily: "var(--ws-mono)", fontSize: 12 }}>
                <span className="ws-dim" style={{ flex: 1 }}>{p.k}</span>
                <span className="ws-text-strong">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ws-grid ws-grid-2" style={{ marginBottom: 14 }}>
        <div className="ws-card">
          <strong>Stat Exposure</strong>
          <div className="ws-stack" style={{ marginTop: 8 }}>
            {topStats.map((s: any) => (
              <div key={s.k} className="ws-row-between" style={{ fontFamily: "var(--ws-mono)", fontSize: 12 }}>
                <span className="ws-dim" style={{ flex: 1, textTransform: "uppercase" }}>{s.k}</span>
                <span className="ws-text-strong">{s.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ws-card">
          <strong>Correlations</strong>
          <div className="ws-stack" style={{ marginTop: 8 }}>
            {(portfolio?.correlations?.clusters || []).slice(0, 8).map((c, i) => (
              <div key={i} style={{ fontSize: 12 }}>
                <span style={{ color: c.level === "high" ? "var(--ws-negative)" : c.level === "moderate" ? "var(--ws-warn)" : "var(--ws-text-dim)", fontWeight: 600, marginRight: 6 }}>
                  {c.level.toUpperCase()}
                </span>
                <span className="ws-dim">{c.note}</span>
              </div>
            ))}
            {!portfolio?.correlations?.clusters?.length && <div className="ws-empty">No correlations detected.</div>}
          </div>
        </div>
      </div>

      {portfolio?.warnings?.length ? (
        <div className="ws-card">
          <strong>Notes</strong>
          <div className="ws-stack" style={{ marginTop: 8 }}>
            {portfolio.warnings.map((w, i) => {
              const text = typeof w === "string" ? w : w.label
              const lvl  = typeof w === "string" ? "moderate" : w.level
              const icon = lvl === "high" ? "⚠️" : "🔶"
              return (
                <div key={i} style={{ fontSize: 12, color: "var(--ws-text-dim)" }}>
                  {icon} {text}
                </div>
              )
            })}
          </div>
          <div className="ws-trust-note">
            Notes are informational, not punitive. Consider trimming when game/player concentration appears multiple times.
          </div>
        </div>
      ) : (
        <div className="ws-card">
          <div className="ws-trust-note">
            No concentration notes — portfolio looks balanced across players, games, stats, and books.
          </div>
        </div>
      )}
    </div>
  )
}
