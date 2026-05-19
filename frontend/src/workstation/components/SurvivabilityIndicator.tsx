import type { FeaturedPlay } from "../types"

// ─────────────────────────────────────────────────────────────────────────────
// SurvivabilityIndicator — Phase CA-3d Item 0001 Increment 3c canonical render
// authority for the survivability dimension.
//
// Original doctrine (Phase CA-3d Item 0001):
//   Bettor-readable survivability surface. Renders below convictionNote on
//   every play that has a canonical survivability gate result. Deterministic
//   phrase (NO LLM). Color distinguishes passes vs fails state while NEVER
//   hiding the underlying battlefield row (anti-sterilization preserved).
//   Absent when canonical survivability gate admitted via neutral-fallback
//   (pitcher / under-side / minor / missing-signals → undefined fields).
//
// Six-element canonical-helper-doctrine header (per Law 24 + Law 30):
//   - Phase lineage:       Phase CA-3d Item 0001 Increment 3c
//   - Extraction phase:    NEW (analogous to ConvictionNote P1A-T3 pattern)
//   - Forbidden list:      no FE reinterpretation of survivabilityReasonTag,
//                          no synthesized phrases, no recomputation of factor,
//                          no volatility/fragility conflation, no per-player
//                          rendering
//   - Absence policy:      helper renders nothing when survivabilityFlag is
//                          undefined; consumers invoke unconditionally
//   - Anti-fabrication:    every rendered string traces to canonical
//                          survivabilityPhrase (from backend SURVIVABILITY_PHRASES)
//                          or to the reasonTag itself; never invented
//   - Indexed-access type: FeaturedPlay["survivabilityFlag"] etc. (single
//                          source of truth at the type level)
//
// Battlefield-vs-curated alignment (Law 18):
//   Battlefield rows that have a canonical overlap may render this helper
//   (signaling that the curated layer has marked the play as robust/fragile).
//   Battlefield rows without overlap render nothing — honest absence.
//   The bettor sees the dimensional signal, not the absence.
//
// Four-axis Law 30 alignment:
//   This helper renders the SURVIVES axis answer ("How does it survive?").
//   ConvictionNote renders the WHO axis answer (PCE-1A role-supported edge).
//   Future role-ownership / game-flow / market-psychology helpers render
//   the remaining axes. The bettor reads the four-question schema by reading
//   the four canonical helpers — never a synthesized aggregate.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  survivabilityFlag?:      FeaturedPlay["survivabilityFlag"]
  survivabilityReasonTag?: FeaturedPlay["survivabilityReasonTag"]
  survivabilityPhrase?:    FeaturedPlay["survivabilityPhrase"]
}

export function SurvivabilityIndicator({
  survivabilityFlag,
  survivabilityReasonTag,
  survivabilityPhrase,
}: Props) {
  // Helper-owned absence policy (Law 19): when flag is undefined, render
  // nothing. Consumers invoke unconditionally; we own the decision.
  if (!survivabilityFlag) return null
  if (!survivabilityPhrase && !survivabilityReasonTag) return null

  // Display priority: canonical phrase first; reasonTag fallback only if
  // phrase absent. Both trace to SURVIVABILITY_PHRASES / SIGNAL_IDS in
  // bettorLanguage.js — never synthesized FE-side.
  const text = survivabilityPhrase || survivabilityReasonTag

  // Color authority: passes → positive (green-ish), fails → warn (orange-ish).
  // Mapping is deterministic per reasonTag class; never per-player.
  const color = survivabilityFlag === "passes"
    ? "var(--ws-good, #2e7d32)"
    : "var(--ws-warn, #b26a00)"

  return (
    <div
      className="ws-feat-survivability"
      style={{
        fontStyle: "italic",
        opacity: 0.85,
        color: color,
      }}
      title={`Survivability gate (Item 0001): ${survivabilityReasonTag || "unknown-tag"} — derived from canonical lineupSpot × plate-appearance proxy × run-environment × HR-carry environment`}
    >
      △ {text}
    </div>
  )
}
