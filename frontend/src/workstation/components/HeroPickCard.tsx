import type { FeaturedPlay } from "../types"
import { fmtOdds, fmtPct, compactStat, teamAbbrev } from "../utils"
import { useBuilder } from "../builderContext"

interface Props {
  play: FeaturedPlay | null
  anchorCount: number
}

/**
 * HeroPickCard — the nuclear play of the night.
 * Occupies the top of the dashboard. Designed to dominate visually and
 * communicate ONE clear message: "this is the play."
 *
 * Uses anchors[0] from the featured output. AttackNote is the primary text.
 */
export function HeroPickCard({ play, anchorCount }: Props) {
  const builder = useBuilder()

  if (!play) {
    return (
      <div className="ws-hero-card ws-hero-card-empty">
        <div className="ws-hero-label">☢️ NUCLEAR PICK</div>
        <div className="ws-hero-empty-msg">
          Analyst filters haven't cleared a nuclear play yet — slate may still be settling.
          Check the <strong>Tonight's Best</strong> and <strong>High Confidence</strong> buckets below while lines firm up.
        </div>
      </div>
    )
  }

  const team = teamAbbrev(play.team)
  const isUrgent = play.timingUrgency === "immediate"
  const isSoon   = play.timingUrgency === "soon"
  const edgePct  = play.edge != null && play.edge > 0
    ? `+${(play.edge * 100).toFixed(1)}%`
    : null

  return (
    <div className={`ws-hero-card${isUrgent ? " ws-hero-urgent" : isSoon ? " ws-hero-soon" : ""}`}>
      {/* Header row */}
      <div className="ws-hero-topbar">
        <span className="ws-hero-label">☢️ NUCLEAR PICK</span>
        {isUrgent && <span className="ws-hot-label">⏱ ACT NOW</span>}
        {isSoon   && <span className="ws-hot-label ws-hot-soon">⚡ WINDOW CLOSING</span>}
        {play.bestBook && (
          <span className="ws-hero-book">
            {play.bestBook}{play.bookCount && play.bookCount > 1 ? ` +${play.bookCount - 1} books` : ""}
          </span>
        )}
      </div>

      {/* Player + prop */}
      <div className="ws-hero-player-row">
        <span className="ws-hero-player">{play.player}</span>
        {team && <span className="ws-hero-team">{team}</span>}
      </div>

      <div className="ws-hero-prop-row">
        <span className="ws-hero-prop">{compactStat(play.statFamily)} {play.side}{play.line != null ? ` ${play.line}` : ""}</span>
        <span className="ws-hero-odds">{fmtOdds(play.odds)}</span>
        {edgePct && <span className="ws-hero-edge">{edgePct} edge</span>}
        {play.modelProb != null && (
          <span className="ws-hero-prob">{fmtPct(play.modelProb)} model</span>
        )}
      </div>

      {/* The WHY — attack note is the money text */}
      {play.attackNote && (
        <div className="ws-hero-attack">
          {play.attackNote}
        </div>
      )}

      {play.reasoning && (
        <div className="ws-hero-tags">{play.reasoning}</div>
      )}

      {/* CTA */}
      <div className="ws-hero-actions">
        <button
          className="ws-btn ws-btn-primary ws-hero-cta"
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
          + Add to Builder
        </button>
        {anchorCount > 1 && (
          <span className="ws-hero-more">
            {anchorCount - 1} more top pick{anchorCount - 1 === 1 ? "" : "s"} below
          </span>
        )}
      </div>
    </div>
  )
}
