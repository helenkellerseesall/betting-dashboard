import { useMemo, useState } from "react"
import type { AiSlip, AiSlips, AiSlipLeg, SportState } from "../types"
import { fmtOdds, fmtPct, compactStat, teamAbbrev } from "../utils"
import { Badge } from "../components/Badges"
import { useBuilder } from "../builderContext"

const TIERS: { id: keyof AiSlips; label: string; color: string; emoji: string }[] = [
  { id: "safe",       label: "Safe",       color: "var(--ws-vol-safe)",       emoji: "🛡️" },
  { id: "balanced",   label: "Balanced",   color: "var(--ws-vol-balanced)",   emoji: "⚖️" },
  { id: "aggressive", label: "Aggressive", color: "var(--ws-vol-aggressive)", emoji: "⚡" },
  { id: "lotto",      label: "Lotto",      color: "var(--ws-vol-lotto)",      emoji: "🎲" },
]

function tierEmpty(tier: keyof AiSlips): string {
  switch (tier) {
    case "safe":       return "No safe slip cleared the threshold tonight — slate may lean high-variance."
    case "balanced":   return "No balanced slip viable — narrow odds windows or thin candidate pool."
    case "aggressive": return "No aggressive slip met the trust filters — try the balanced tier."
    case "lotto":      return "No lotto slip with positive process found — lotto pool may be empty tonight."
  }
}

function SlipCard({ slip, tier }: { slip: AiSlip; tier: string }) {
  const [open, setOpen] = useState(false)
  const builder = useBuilder()
  const american = slip.combinedAmericanOdds >= 0 ? `+${slip.combinedAmericanOdds}` : `${slip.combinedAmericanOdds}`
  return (
    <div className={`ws-slip tier-${tier}`}>
      <div className="ws-slip-head">
        <span className="ws-slip-odds">{american}</span>
        <span className="ws-mono ws-pos">EV {fmtPct(slip.ev)}</span>
        <span className="ws-mono ws-dim">prob {fmtPct(slip.combinedModelProb)}</span>
        <span className="ws-slip-reason">{slip.reasoning}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        {slip.legs.map((l) => <SlipLegRow key={l.id} leg={l} reasoning={slip.legReasonings} />)}
      </div>
      {slip.narrative && slip.narrative.length ? (
        <div style={{ marginTop: 8 }}>
          <button className="ws-link" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide reasoning" : "Why this slip?"}
          </button>
          {open ? (
            <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12, color: "var(--ws-text-dim)" }}>
              {slip.narrative.map((line, i) => <li key={i} style={{ marginBottom: 2 }}>{line}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="ws-slip-actions">
        <button className="ws-btn ws-btn-primary" onClick={() => builder.loadAllSlipLegs(slip.legs)}>
          ➜ Load all into builder
        </button>
      </div>
    </div>
  )
}

function SlipLegRow({ leg, reasoning }: { leg: AiSlipLeg; reasoning?: { legId: string; player: string; reason: string }[] }) {
  const builder = useBuilder()
  const reason = reasoning?.find((r) => r.legId === leg.id)?.reason
  const id = leg.id
  const added = builder.isLegAdded(id)
  return (
    <div className="ws-slip-leg">
      <span className="ws-text-strong">{leg.player} <span className="ws-dim">{teamAbbrev(leg.team)}</span></span>
      <span>{compactStat(leg.statFamily)}</span>
      <span>{leg.side} {leg.line ?? ""}</span>
      <span className="ws-mono">{fmtOdds(leg.odds)}</span>
      <span className="ws-dim">{leg.book || ""}</span>
      <span className="ws-dim" style={{ fontFamily: "var(--ws-sans)", fontSize: 11 }}>{reason}</span>
      <button
        className={added ? "ws-btn ws-btn-danger ws-btn-icon" : "ws-btn ws-btn-icon"}
        onClick={() => added ? builder.removeLeg(id) : builder.addLegFromAiSlipLeg(leg)}
      >
        {added ? "−" : "+"}
      </button>
    </div>
  )
}

export function AiSlipsView({ state }: { state: SportState | null }) {
  const [activeTier, setActiveTier] = useState<keyof AiSlips | "all">("all")
  const slipsByTier = state?.aiSlips || { safe: [], balanced: [], aggressive: [], lotto: [] }
  const total = useMemo(() =>
    slipsByTier.safe.length + slipsByTier.balanced.length + slipsByTier.aggressive.length + slipsByTier.lotto.length,
    [slipsByTier])

  if (!state) return <div className="ws-empty">Loading…</div>

  const tiersToRender = activeTier === "all" ? TIERS : TIERS.filter((t) => t.id === activeTier)

  return (
    <div>
      <h2 className="ws-section-title">
        AI Slip Center <small>{total} slips · {state.aiSlipsSummary?.summary || "—"}</small>
      </h2>

      <div className="ws-filters">
        <button className={`ws-pill ${activeTier === "all" ? "active" : ""}`} onClick={() => setActiveTier("all")}>All</button>
        {TIERS.map((t) => (
          <button key={t.id} className={`ws-pill ${activeTier === t.id ? "active" : ""}`} onClick={() => setActiveTier(t.id)}>
            <span style={{ marginRight: 4 }}>{t.emoji}</span>{t.label} <span className="ws-dim" style={{ marginLeft: 6 }}>{slipsByTier[t.id].length}</span>
          </button>
        ))}
      </div>

      {state.aiSlipsSummary?.warnings?.length ? (
        <div className="ws-card" style={{ marginBottom: 14 }}>
          <strong style={{ marginRight: 8 }}>Warnings:</strong>
          {state.aiSlipsSummary.warnings.map((w, i) => (
            <Badge key={i} kind="stale">{w}</Badge>
          ))}
        </div>
      ) : null}

      <div className={tiersToRender.length === 1 ? "" : "ws-grid ws-grid-2"}>
        {tiersToRender.map((t) => {
          const slips = slipsByTier[t.id]
          return (
            <div key={t.id}>
              <h3 style={{ fontSize: 12, color: t.color, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px" }}>
                {t.emoji} {t.label} <span className="ws-dim" style={{ fontSize: 11 }}>({slips.length})</span>
              </h3>
              {!slips.length && <div className="ws-empty">{tierEmpty(t.id)}</div>}
              {slips.map((s) => <SlipCard key={s.id} slip={s} tier={t.id} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
