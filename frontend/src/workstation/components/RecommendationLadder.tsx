import type { FeaturedPlay, RecommendationLadder as Ladder } from "../types"
import { fmtOdds, compactStat, teamAbbrev } from "../utils"
import { useBuilder } from "../builderContext"
// Phase Recommendation-Hierarchy-1A (HIER-3): reuse deterministic tooltip
// helpers established in Phase Operator-Experience-1B-1 — no new helpers,
// no parallel translation layer. Same hover semantics across the workstation.
import {
  tooltipForConsensusConfidence,
  tooltipForBookCount,
  tooltipForVolatility,
  tooltipForBestImpDelta,
  tooltipForProcessNote,
  tooltipForAttackNote,
  tooltipForAvoidReason,
} from "../tooltips"

/**
 * RecommendationLadder — Phase Recommendation-Hierarchy-1A (HIER-3).
 *
 * The deterministic decision hierarchy for the workstation.
 *
 * Renders 7 fixed-cardinality named role-slots that the operator can scan in
 * a single glance:
 *
 *   Row 1 (positive lanes):
 *     🔥 BEST CURRENT PLAY  · 🛡 SAFEST PLAY  · ⚡ BEST DISAGREEMENT
 *     · 🎯 BEST BALANCED  · 🚀 BEST UPSIDE
 *
 *   Row 2 (avoid lanes):
 *     ⚠ MOST OVERPRICED  · ⚠ HIGHEST TRAP RISK
 *
 * Doctrine:
 *   - Pure surfacing layer. Every slot value comes directly from the backend
 *     `featured.recommendationLadder` payload (Phase HIER-1 in
 *     buildFeaturedPlays.js). No frontend selection, no fabrication, no
 *     fallback picks.
 *   - Empty slots render an honest "(no qualifying X tonight)" line. The
 *     ladder NEVER manufactures a placeholder play to fill a missing slot.
 *   - Reuses existing tooltip helpers and existing annotation conventions
 *     (conf / vol / books / Δ¢ strip) so hover semantics are identical
 *     across the workstation.
 *   - Renders ABOVE HeroPickCard. The ladder is the decision-grade scan-line;
 *     the hero card retains emotional emphasis on the single highest-composite
 *     anchor (which is also the bestOverall slot here).
 */
interface Props {
  ladder: Ladder | null | undefined
}

interface SlotSpec {
  key:        keyof Ladder
  icon:       string
  label:      string
  emptyLine:  string
  variant:    "positive" | "avoid"
}

const POSITIVE_SLOTS: SlotSpec[] = [
  {
    key: "bestOverall",
    icon: "🔥",
    label: "BEST CURRENT PLAY",
    emptyLine: "(no qualifying best play tonight)",
    variant: "positive",
  },
  {
    key: "safestPlay",
    icon: "🛡",
    label: "SAFEST PLAY",
    emptyLine: "(no qualifying safe play tonight)",
    variant: "positive",
  },
  {
    key: "bestDisagreement",
    icon: "⚡",
    label: "BEST DISAGREEMENT",
    emptyLine: "(no qualifying disagreement edge tonight)",
    variant: "positive",
  },
  {
    key: "bestBalancedPlay",
    icon: "🎯",
    label: "BEST BALANCED",
    emptyLine: "(no qualifying balanced play tonight)",
    variant: "positive",
  },
  {
    key: "bestUpsidePlay",
    icon: "🚀",
    label: "BEST UPSIDE",
    emptyLine: "(no qualifying upside play tonight)",
    variant: "positive",
  },
  // Phase BNSB-1 / BC-6: slot 8 — Believable Upside.
  // Backend buildRecommendationLadder picks bestBelievableUpside from BC-5's
  // buildBelievableUpsideTickets bucket (gates: depth ∈ {top, middle} AND
  // impliedTeamTotal ≥ 4.5 AND hrEnvironmentTag !== HR_SUPPRESSING).
  // Empty-doctrine identical to other 7 slots — honest "(no qualifying X tonight)".
  {
    key: "bestBelievableUpside",
    icon: "💡",
    label: "BELIEVABLE UPSIDE",
    emptyLine: "(no qualifying believable upside tonight)",
    variant: "positive",
  },
  // Phase BNSB-1 / OE-7: slot 9 — Explosive Upside.
  // Backend buildRecommendationLadder picks bestExplosiveUpside from OE-6's
  // buildExplosiveUpsideTickets bucket (events tagged EXPLOSIVE per OE-5:
  // gameTotal ≥ 9.5 + avg(impliedTeamTotal) ≥ 4.5 + wind-out + no HR_SUPPRESSING).
  {
    key: "bestExplosiveUpside",
    icon: "💥",
    label: "EXPLOSIVE UPSIDE",
    emptyLine: "(no qualifying explosive environment tonight)",
    variant: "positive",
  },
]

const AVOID_SLOTS: SlotSpec[] = [
  {
    key: "mostOverpricedAvoid",
    icon: "⚠",
    label: "MOST OVERPRICED",
    emptyLine: "(no overpriced spots flagged tonight)",
    variant: "avoid",
  },
  {
    key: "highestTrapRiskAvoid",
    icon: "⚠",
    label: "HIGHEST TRAP RISK",
    emptyLine: "(no trap-shaped ladders flagged tonight)",
    variant: "avoid",
  },
]

export function RecommendationLadder({ ladder }: Props) {
  // Defensive: backend now emits the 9-key object (Phase BNSB-1 / BC-6 + OE-7);
  // tolerate undefined during transitional payloads. Empty doctrine is preserved
  // either way — slots 8 + 9 render honest "(no qualifying X tonight)" lines.
  const safeLadder: Ladder = ladder ?? {
    bestOverall: null, safestPlay: null, bestUpsidePlay: null,
    bestBalancedPlay: null, bestDisagreement: null,
    mostOverpricedAvoid: null, highestTrapRiskAvoid: null,
    bestBelievableUpside: null, bestExplosiveUpside: null,
  }

  return (
    <div className="ws-rec-ladder" style={{ marginBottom: 14 }}>
      <div
        className="ws-supporting-label"
        style={{ marginBottom: 6 }}
        title="Deterministic decision hierarchy — each slot is the top pick from one canonical bucket. Empty slots are honest: no fabricated fallback picks."
      >
        Recommendation Hierarchy
      </div>

      {/* Row 1 — 5 positive lanes */}
      <div
        className="ws-rec-ladder-row"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 8,
          marginBottom: 8,
        }}
      >
        {POSITIVE_SLOTS.map((spec) => (
          <SlotCard
            key={spec.key as string}
            spec={spec}
            play={safeLadder[spec.key] ?? null}
          />
        ))}
      </div>

      {/* Row 2 — 2 avoid lanes, visually separated */}
      <div
        className="ws-rec-ladder-row ws-rec-ladder-avoids"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 8,
          borderTop: "1px dashed var(--ws-border, rgba(255,255,255,0.08))",
          paddingTop: 6,
        }}
      >
        {AVOID_SLOTS.map((spec) => (
          <SlotCard
            key={spec.key as string}
            spec={spec}
            play={safeLadder[spec.key] ?? null}
          />
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SlotCard — one named role-slot in the ladder.                                */
/*                                                                              */
/* Empty-slot doctrine is enforced here: when play === null we render an        */
/* honest single-line absence message and NEVER synthesize a placeholder.       */
/* ─────────────────────────────────────────────────────────────────────────── */
function SlotCard({ spec, play }: { spec: SlotSpec; play: FeaturedPlay | null }) {
  const builder = useBuilder()
  const isAvoid = spec.variant === "avoid"

  // Empty-slot — honest "(no qualifying X tonight)". No placeholder play.
  if (!play) {
    return (
      <div
        className="ws-rec-slot ws-rec-slot-empty"
        style={{
          padding: "8px 10px",
          border: "1px solid var(--ws-border, rgba(255,255,255,0.08))",
          borderRadius: 6,
          background: "var(--ws-surface-2, rgba(255,255,255,0.02))",
          opacity: 0.7,
        }}
      >
        <div className="ws-rec-slot-head" style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, fontWeight: 600 }}>
          <span style={{ fontSize: 13 }}>{spec.icon}</span>
          <span style={{ letterSpacing: 0.3, color: isAvoid ? "var(--ws-warn)" : "var(--ws-dim)" }}>{spec.label}</span>
        </div>
        <div className="ws-rec-slot-empty-line" style={{ fontSize: 11, fontStyle: "italic", color: "var(--ws-dim)", marginTop: 4 }}>
          {spec.emptyLine}
        </div>
      </div>
    )
  }

  // Populated — reuse existing FeaturedPlay conventions for inline annotations.
  // Phase Operator-Experience-1A annotation strip: conf / vol / books / Δ¢.
  const confStr = Number.isFinite(play.consensusConfidence)
    ? `conf=${(play.consensusConfidence as number).toFixed(2)}`
    : null
  const booksStr = play.bookCount && play.bookCount >= 1
    ? `(${play.bookCount} book${play.bookCount === 1 ? "" : "s"})`
    : null
  const volStr = play.volatility ? `vol: ${play.volatility}` : null
  const deltaStr = Number.isFinite(play.bestImpDelta)
    ? `Δ${(play.bestImpDelta as number) >= 0 ? "+" : ""}${((play.bestImpDelta as number) * 100).toFixed(1)}¢`
    : null

  const team = teamAbbrev(play.team)
  const accentColor = isAvoid ? "var(--ws-warn)" : "var(--ws-positive)"

  return (
    <div
      className={`ws-rec-slot ws-rec-slot-${spec.variant}`}
      style={{
        padding: "8px 10px",
        border: "1px solid var(--ws-border, rgba(255,255,255,0.08))",
        borderTop: `2px solid ${accentColor}`,
        borderRadius: 6,
        background: "var(--ws-surface-2, rgba(255,255,255,0.02))",
        position: "relative",
      }}
    >
      {/* Slot header */}
      <div
        className="ws-rec-slot-head"
        style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, fontWeight: 600 }}
      >
        <span style={{ fontSize: 13 }}>{spec.icon}</span>
        <span style={{ letterSpacing: 0.3, color: isAvoid ? "var(--ws-warn)" : "var(--ws-fg, inherit)" }}>
          {spec.label}
        </span>
      </div>

      {/* Player + team */}
      <div className="ws-rec-slot-player" style={{ marginTop: 4, fontSize: 13, fontWeight: 500 }}>
        {play.player}
        {team && <span className="ws-dim" style={{ fontSize: 11, marginLeft: 4 }}>{team}</span>}
      </div>

      {/* Prop + side + line + odds */}
      <div className="ws-rec-slot-prop" style={{ marginTop: 2, fontSize: 12, color: "var(--ws-dim)" }}>
        {compactStat(play.statFamily)} {play.side}{play.line != null ? ` ${play.line}` : ""}
        <span style={{ marginLeft: 6, fontFamily: "var(--ws-mono)", color: "var(--ws-fg, inherit)" }}>
          {fmtOdds(play.odds)}
        </span>
        {play.bestBook && (
          <span className="ws-dim" style={{ fontSize: 10, marginLeft: 6 }}>{play.bestBook}</span>
        )}
      </div>

      {/* Inline annotation strip — only renders annotations whose source field is present. */}
      {(confStr || booksStr || volStr || deltaStr) && (
        <div
          className="ws-rec-slot-context"
          style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10, fontFamily: "var(--ws-mono)", color: "var(--ws-dim)", marginTop: 4 }}
        >
          {confStr && (
            <span title={tooltipForConsensusConfidence(play.consensusConfidence, play.bookCount)}>{confStr}</span>
          )}
          {booksStr && (
            <span title={tooltipForBookCount(play.bookCount)}>{booksStr}</span>
          )}
          {volStr && (
            <span title={tooltipForVolatility(play.volatility)}>{volStr}</span>
          )}
          {deltaStr && (
            <span
              title={tooltipForBestImpDelta(play.bestImpDelta, play.bestBook)}
              style={{ color: Number.isFinite(play.bestImpDelta) && (play.bestImpDelta as number) < 0 ? "var(--ws-positive)" : "var(--ws-dim)" }}
            >
              {deltaStr}
            </span>
          )}
        </div>
      )}

      {/* WHY — attackNote preferred, processNote next, then a final avoidReason
          for AVOID slots. Hover surfaces existing deterministic tooltips. */}
      {play.attackNote && (
        <div
          className="ws-rec-slot-attack"
          style={{ marginTop: 4, fontSize: 11, lineHeight: 1.3 }}
          title={tooltipForAttackNote(play.attackNote)}
        >
          {play.attackNote}
        </div>
      )}
      {!play.attackNote && play.processNote && (
        <div
          className="ws-rec-slot-process"
          style={{ marginTop: 4, fontSize: 11, fontStyle: "italic", opacity: 0.85 }}
          title={tooltipForProcessNote(play.processNote)}
        >
          — {play.processNote}
        </div>
      )}
      {play.avoidReason && (
        <div
          className="ws-rec-slot-avoid-reason"
          style={{ marginTop: 4, fontSize: 11, fontStyle: "italic", color: "var(--ws-warn)" }}
          title={tooltipForAvoidReason(play.avoidReason)}
        >
          ⚠ {play.avoidReason}
        </div>
      )}

      {/* Add-to-builder action — only on positive slots; avoid slots are inspect-only. */}
      {!isAvoid && (
        <button
          className="ws-btn ws-btn-icon"
          style={{ marginTop: 6, fontSize: 11, padding: "1px 6px" }}
          title="Add to builder"
          onClick={() =>
            builder.addLegFromCandidate({
              id:         play.id,
              player:     play.player,
              team:       play.team,
              eventId:    play.eventId,
              matchup:    play.matchup,
              statFamily: play.statFamily,
              propType:   play.propType,
              side:       play.side,
              line:       play.line,
              odds:       play.odds,
              book:       play.book,
              modelProb:  play.modelProb,
              edge:       play.edge,
            })
          }
        >
          + add
        </button>
      )}
    </div>
  )
}
