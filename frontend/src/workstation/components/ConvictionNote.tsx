import type { FeaturedPlay } from "../types"

// ─────────────────────────────────────────────────────────────────────────────
// ConvictionNote — Phase P1A-T3 canonical render authority.
//
// Original doctrine (Phase Player-Conviction-Engine-1A / PCE-1A):
//   Bettor-readable conviction surface. Renders below processNote on every
//   play that has canonical PCE signals. Deterministic phrase (NO LLM). Color
//   distinguishes positive vs negative tag while NEVER hiding the underlying
//   play. Absent when canonical PCE signals are absent (anti-fabrication).
//
// Phase P1A-T3 extraction:
//   This module is the SINGLE canonical conviction-render authority for the
//   workstation. Extracted verbatim from FeaturedCard.tsx (former lines
//   128–150) so RecommendationLadder slot picks render the IDENTICAL surface
//   — same typography, same spacing hierarchy, same tooltip text, same color
//   authority, same absence behavior.
//
//   Forbidden by P1A-T3 doctrine (do not introduce here or in any consumer):
//     - FE reinterpretation of convictionReasonTag → color
//     - synthesized convictionNote values
//     - phrase widening (the helper renders exactly the backend-emitted note)
//     - survivability recomputation
//     - backend mutation
//     - visual redesign
//
//   Consumers MUST pass canonical fields straight from a FeaturedPlay; this
//   helper performs NO inference and NO fallback. When convictionNote is
//   absent, the helper renders nothing (honest absence).
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  convictionNote?: FeaturedPlay["convictionNote"]
  convictionReasonTag?: FeaturedPlay["convictionReasonTag"]
}

export function ConvictionNote({ convictionNote, convictionReasonTag }: Props) {
  if (!convictionNote) return null
  return (
    <div
      className="ws-feat-reason"
      style={{
        fontStyle: "italic",
        opacity: 0.85,
        color:
          convictionReasonTag === "PCE:earned" || convictionReasonTag === "PCE:supported"
            ? "var(--ws-good, #2e7d32)"
            : convictionReasonTag === "PCE:thin" || convictionReasonTag === "PCE:ecology_light"
              ? "var(--ws-warn, #b26a00)"
              : "var(--ws-muted, #6b6b6b)",
      }}
      title={`Player Conviction Engine (PCE-1A): ${convictionReasonTag || "neutral"} — derived from canonical lineupSpot × plate-appearance proxy × stat-side coherence × model-trust`}
    >
      ◆ {convictionNote}
    </div>
  )
}
