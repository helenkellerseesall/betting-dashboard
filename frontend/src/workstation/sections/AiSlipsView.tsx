import { useMemo, useState } from "react"
import type { AiSlip, AiSlips, AiSlipLeg, SportState } from "../types"
import { fmtOdds, fmtPct, compactStat, teamAbbrev } from "../utils"
import { Badge } from "../components/Badges"
import { useBuilder } from "../builderContext"
// Phase Operator-Experience-1B-1: deterministic plain-English tooltip helpers.
import {
  tooltipForSlipEv,
  tooltipForSlipProb,
  tooltipForSlipTierChip,
} from "../tooltips"

const TIERS: { id: keyof AiSlips; label: string; color: string; emoji: string }[] = [
  { id: "safe",       label: "Core",        color: "var(--ws-vol-safe)",       emoji: "🛡️" },
  { id: "balanced",   label: "Value Mix",   color: "var(--ws-vol-balanced)",   emoji: "⚖️" },
  { id: "aggressive", label: "Fire Shots",  color: "var(--ws-vol-aggressive)", emoji: "🔥" },
  { id: "lotto",      label: "Moon Shots",  color: "var(--ws-vol-lotto)",      emoji: "🌙" },
]

function tierEmpty(tier: keyof AiSlips): string {
  switch (tier) {
    case "safe":       return "No Core parlay built tonight — slate leans volatile. Try Value Mix."
    case "balanced":   return "No Value Mix parlay found — odds windows are tight or the pool is thin."
    case "aggressive": return "No Fire Shot cleared tonight — volatile legs may be exhausted. Try Value Mix."
    case "lotto":      return "No Moon Shot available tonight — lotto pool may be empty or lines moved."
  }
}

function SlipCard({ slip, tier }: { slip: AiSlip; tier: string }) {
  const [open, setOpen] = useState(false)
  const builder = useBuilder()
  const american = slip.combinedAmericanOdds >= 0 ? `+${slip.combinedAmericanOdds}` : `${slip.combinedAmericanOdds}`

  // Phase BNSB-1A (BNSB-5): reinforcement transparency ladder.
  // Render only when backend supplies the optional reinforcement fields so
  // legacy payloads still render cleanly. Anti-fabrication: every value is
  // shown exactly as backend returned it (no synthesis, no interpolation).
  const hasReinforcement =
    typeof slip.calibratedCombinedModelProb === "number" ||
    typeof slip.rawCombinedModelProb === "number" ||
    typeof slip.oe11ReinforcementBoost === "number"

  // Phase BNSB-1A (BNSB-3): bettor-language phrases (optional, present-only).
  const hasLanguage = Array.isArray(slip.bettorLanguageSummary) && slip.bettorLanguageSummary.length > 0

  return (
    <div className={`ws-slip tier-${tier}`}>
      <div className="ws-slip-head">
        <span className="ws-slip-odds" title="Combined American odds for the full parlay. Positive = underdog payoff; negative = favorite cost.">{american}</span>
        <span className="ws-mono ws-pos" title={tooltipForSlipEv(slip.ev)}>EV {fmtPct(slip.ev)}</span>
        <span className="ws-mono ws-dim" title={tooltipForSlipProb(slip.combinedModelProb)}>prob {fmtPct(slip.combinedModelProb)}</span>
        <span className="ws-slip-reason">{slip.reasoning}</span>
      </div>

      {/* Phase BNSB-1A (BNSB-3): bettor-language signal phrases — concise
          plain-English summary derived deterministically from VBI signals.
          Only rendered when populated; never fabricated. */}
      {hasLanguage && (
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {slip.bettorLanguageSummary!.map((phrase, i) => (
            <span
              key={`lang-${i}`}
              className="ws-risk-flag"
              style={{ fontSize: 11 }}
              title="Bettor-language signal (deterministically derived from canonical VBI signals)."
            >
              💬 {phrase}
            </span>
          ))}
        </div>
      )}

      {/* Phase BNSB-1A (BNSB-5): OE-11 reinforcement ladder.
          raw → calibrated → reinforced. Each step rendered only when its
          backend field is present (Number.isFinite). The boost is the
          aggregate pairwise reinforcement applied to joint probability,
          capped at 0.03 per OE-11 doctrine. Pure observational surfacing. */}
      {hasReinforcement && (
        <div
          style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 11 }}
          title="OE-11 reinforcement ladder — raw multiplicative product → FAMILY_CALIBRATION → pairwise ecology reinforcement boost (capped at 0.03)."
        >
          {Number.isFinite(slip.rawCombinedModelProb) && (
            <span className="ws-dim">
              raw {fmtPct(slip.rawCombinedModelProb!)}
            </span>
          )}
          {Number.isFinite(slip.rawCombinedModelProb) && Number.isFinite(slip.calibratedCombinedModelProb) && (
            <span className="ws-dim">→</span>
          )}
          {Number.isFinite(slip.calibratedCombinedModelProb) && (
            <span className="ws-dim">
              calibrated {fmtPct(slip.calibratedCombinedModelProb!)}
            </span>
          )}
          {Number.isFinite(slip.calibratedCombinedModelProb) && Number.isFinite(slip.oe11ReinforcementBoost) && slip.oe11ReinforcementBoost! > 0 && (
            <span className="ws-dim">→</span>
          )}
          {Number.isFinite(slip.oe11ReinforcementBoost) && slip.oe11ReinforcementBoost! > 0 && (
            <span className="ws-pos">
              ✚ reinforcement +{fmtPct(slip.oe11ReinforcementBoost!)}
            </span>
          )}
          {Number.isFinite(slip.oe11ReinforcementBoost) && slip.oe11ReinforcementBoost! > 0 && (
            <span className="ws-dim">→ final {fmtPct(slip.combinedModelProb)}</span>
          )}
          {Number.isFinite(slip.oe11ReinforcementBoost) && slip.oe11ReinforcementBoost === 0 && (
            <span className="ws-dim" style={{ fontStyle: "italic" }}>
              no pairwise reinforcement applied
            </span>
          )}
        </div>
      )}

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
          ➜ Build this parlay
        </button>
        {/* Phase BNSB-1B (BNSB-1B-8): one-click cross-section affordance —
            dispatches `ws:analyze-slip`; Workstation captures + routes to the
            Analyze section + pre-loads this slip into AnalyzeSlipView. */}
        <button
          className="ws-btn"
          style={{ marginLeft: 6 }}
          title="Send this parlay to the analyzer."
          onClick={() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("ws:analyze-slip", { detail: { slip } }))
            }
          }}
        >
          🔍 Analyze this
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
        🎲 AI Parlay Engine <small>{total} parlays built · {state.aiSlipsSummary?.summary || "—"}</small>
      </h2>

      <div className="ws-filters">
        <button
          className={`ws-pill ${activeTier === "all" ? "active" : ""}`}
          onClick={() => setActiveTier("all")}
          title="Show parlays from every tier (safe / balanced / aggressive / lotto)."
        >All</button>
        {TIERS.map((t) => (
          <button
            key={t.id}
            className={`ws-pill ${activeTier === t.id ? "active" : ""}`}
            onClick={() => setActiveTier(t.id)}
            title={tooltipForSlipTierChip(t.id)}
          >
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
              <h3
                style={{ fontSize: 12, color: t.color, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px" }}
                title={tooltipForSlipTierChip(t.id)}
              >
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
