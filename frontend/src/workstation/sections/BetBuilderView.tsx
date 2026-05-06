import { useBuilder } from "../builderContext"
import { fmtOdds, fmtPct, compactStat, teamAbbrev } from "../utils"

export function BetBuilderDock() {
  const { state, removeLeg, clear, setStake } = useBuilder()
  const { legs, stake, preview, loading } = state

  return (
    <div className="ws-builder-dock">
      <div className="ws-row-between">
        <strong>Bet Builder</strong>
        <span className="ws-dim" style={{ fontSize: 11 }}>{legs.length} leg{legs.length === 1 ? "" : "s"}</span>
      </div>

      <div className="ws-stack" style={{ gap: 4 }}>
        {!legs.length && <div className="ws-empty" style={{ padding: 8 }}>No legs yet. Add from any section.</div>}
        {legs.map((l) => (
          <div key={l.id} className="ws-builder-leg">
            <span>
              <span className="ws-text-strong">{l.player}</span>{" "}
              <span className="ws-dim">{teamAbbrev(l.team)} · {compactStat(l.statFamily)} {l.side} {l.line ?? ""}</span>
              <span className="ws-dim" style={{ marginLeft: 6 }}>· {l.book || ""}</span>
            </span>
            <span className="ws-mono">{fmtOdds(l.odds)}</span>
            <button className="ws-btn ws-btn-icon ws-btn-danger" onClick={() => removeLeg(l.id)}>−</button>
          </div>
        ))}
      </div>

      <div className="ws-row" style={{ gap: 8, alignItems: "center", marginTop: 4 }}>
        <span className="ws-dim" style={{ fontSize: 12 }}>Stake</span>
        <input
          className="ws-input"
          type="number"
          step="1"
          min="1"
          value={stake}
          onChange={(e) => setStake(Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 80 }}
        />
        {legs.length > 0 && (
          <button className="ws-btn ws-btn-danger" style={{ marginLeft: "auto" }} onClick={clear}>Clear</button>
        )}
      </div>

      {legs.length > 0 && (
        <div className="ws-builder-meta" style={{ borderTop: "1px solid var(--ws-border)", paddingTop: 8 }}>
          <span className="ws-dim">Combined</span>
          <span className="ws-text-strong">{preview?.combinedAmerican != null ? fmtOdds(preview.combinedAmerican) : "—"}</span>
          <span className="ws-dim">Decimal</span>
          <span>{preview?.combinedDecimal != null ? preview.combinedDecimal.toFixed(2) : "—"}</span>
          <span className="ws-dim">Model</span>
          <span>{preview?.modelProb != null ? fmtPct(preview.modelProb) : "—"}</span>
          <span className="ws-dim">Implied</span>
          <span>{preview?.impliedProb != null ? fmtPct(preview.impliedProb) : "—"}</span>
          <span className="ws-dim">Edge</span>
          <span className={preview?.edge != null && preview.edge >= 0 ? "ws-pos" : "ws-neg"}>
            {preview?.edge != null ? fmtPct(preview.edge) : "—"}
          </span>
          <span className="ws-dim">EV</span>
          <span className={preview?.ev != null && preview.ev >= 0 ? "ws-pos" : "ws-neg"}>
            {preview?.ev != null ? fmtPct(preview.ev) : "—"}
          </span>
          <span className="ws-dim">Payout</span>
          <span className="ws-text-strong">${preview?.payout != null ? preview.payout.toFixed(2) : "—"}</span>
          <span className="ws-dim">Score</span>
          <span style={{ color: preview && preview.portfolioScore != null
              ? (preview.portfolioScore >= 70 ? "var(--ws-positive)" :
                 preview.portfolioScore >= 50 ? "var(--ws-warn)" : "var(--ws-negative)")
              : "var(--ws-text-dim)" }}>
            {preview?.portfolioScore ?? "—"}
          </span>
        </div>
      )}

      {preview?.warnings?.length ? (
        <div className="ws-stack" style={{ borderTop: "1px solid var(--ws-border)", paddingTop: 8 }}>
          {preview.warnings.slice(0, 5).map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--ws-warn)" }}>{w}</div>
          ))}
        </div>
      ) : null}

      {preview?.conflicts?.length ? (
        <div className="ws-stack">
          {preview.conflicts.slice(0, 3).map((c, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--ws-negative)" }}>❌ {c.note}</div>
          ))}
        </div>
      ) : null}

      {loading && <div className="ws-dim" style={{ fontSize: 11 }}>updating…</div>}
    </div>
  )
}

export function BetBuilderView() {
  return (
    <div>
      <h2 className="ws-section-title">Bet Builder</h2>
      <div className="ws-grid ws-grid-2" style={{ alignItems: "start" }}>
        <BetBuilderDock />
        <div className="ws-card">
          <strong>How it works</strong>
          <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13, color: "var(--ws-text-dim)" }}>
            <li>Add legs from any section using the <code className="ws-mono">+</code> buttons.</li>
            <li>Combined odds, payout, edge, and EV update instantly.</li>
            <li>Portfolio score rates correlation, conflicts, and exposure of the slip you're building.</li>
            <li>Warnings flag opposing directions, usage collisions, and stacked game scripts before you place.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
