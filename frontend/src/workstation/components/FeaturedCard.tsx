import type { FeaturedPlay } from "../types"
import { useBuilder } from "../builderContext"
import { fmtOdds, compactStat, teamAbbrev } from "../utils"
// Phase Operator-Experience-1B-1: deterministic plain-English tooltip helpers.
import {
  tooltipForConsensusConfidence,
  tooltipForBookCount,
  tooltipForVolatility,
  tooltipForBestImpDelta,
  tooltipForStaleTag,
  tooltipForProcessNote,
  tooltipForAvoidReason,
} from "../tooltips"

interface Props {
  icon: string
  title: string
  plays: FeaturedPlay[]
  emptyMessage?: string
  showOdds?: boolean
  maxRows?: number
}

/**
 * FeaturedCard — one bucket of curated plays (eg "Tonight's Best", "Best HR").
 * Compact, scannable, and explains the WHY of each pick.
 */
export function FeaturedCard({ icon, title, plays, emptyMessage, showOdds = true, maxRows = 6 }: Props) {
  const builder = useBuilder()
  const rows = (plays || []).slice(0, maxRows)

  return (
    <div className="ws-feat-card">
      <div className="ws-feat-head">
        <span className="ws-feat-icon">{icon}</span>
        <span className="ws-feat-title">{title}</span>
        <span className="ws-feat-count">{plays.length} pick{plays.length === 1 ? "" : "s"}</span>
      </div>

      {!rows.length && (
        <div className="ws-feat-empty">{emptyMessage || "No qualifying plays in this bucket tonight."}</div>
      )}

      {rows.map((p, i) => {
        const team = teamAbbrev(p.team)
        // Phase Operator-Experience-1A — derive inline annotations from existing
        // fields; omit any annotation whose source value is undefined (anti-fabrication).
        // Phase 1B-1: standardize abbreviation to "(N books)" across all cards
        // (was previously "(Nb)" here, "(N books)" elsewhere — operator readability fix).
        const confStr  = Number.isFinite(p.consensusConfidence)
          ? `conf=${(p.consensusConfidence as number).toFixed(2)}`
          : null
        const booksStr = p.bookCount && p.bookCount >= 1
          ? `(${p.bookCount} book${p.bookCount === 1 ? "" : "s"})`   // Phase 1B-1: was "(Nb)"
          : null
        const volStr   = p.volatility ? `vol: ${p.volatility}` : null
        const deltaStr = Number.isFinite(p.bestImpDelta)
          ? `Δ${(p.bestImpDelta as number) >= 0 ? "+" : ""}${((p.bestImpDelta as number) * 100).toFixed(1)}¢`
          : null
        return (
          <div key={p.id || `${p.player}-${i}`} className="ws-feat-row">
            <span className="ws-feat-rank">{i + 1}.</span>
            <span>
              <span className="ws-feat-name">{p.player}</span>
              {team ? <span className="ws-feat-prop"> · {team}</span> : null}
              <div className="ws-feat-prop">
                {compactStat(p.statFamily)} {p.side} {p.line ?? ""}
              </div>
            </span>
            {showOdds ? <span className="ws-feat-odds">{fmtOdds(p.odds)}</span> : <span />}
            <span className="ws-feat-book">{p.bestBook || p.book || "—"}</span>
            <span className="ws-feat-meta">
              {Number.isFinite(p.composite) ? Math.round((p.composite || 0) * 100) : "—"}
            </span>
            <button
              className="ws-btn ws-btn-icon"
              title="Add leg to bet builder"
              onClick={() =>
                builder.addLegFromCandidate({
                  id:         p.id,
                  player:     p.player,
                  team:       p.team,
                  eventId:    p.eventId,
                  matchup:    p.matchup,
                  statFamily: p.statFamily,
                  propType:   p.propType,
                  side:       p.side,
                  line:       p.line,
                  odds:       p.odds,
                  book:       p.book,
                  modelProb:  p.modelProb,
                  edge:       p.edge,
                })
              }
            >+</button>
            {/* Phase Operator-Experience-1A — inline annotations + processNote lifted from tooltip.
                Phase 1B-1: deterministic title= tooltips added to each annotation span. */}
            {(confStr || booksStr || volStr || deltaStr) && (
              <div className="ws-feat-reason" style={{ fontFamily: "var(--ws-mono)", fontSize: 10, color: "var(--ws-dim)" }}>
                {confStr && (
                  <span title={tooltipForConsensusConfidence(p.consensusConfidence, p.bookCount)}>{confStr}</span>
                )}
                {booksStr && (
                  <>{" "}<span title={tooltipForBookCount(p.bookCount)}>{booksStr}</span></>
                )}
                {volStr && (
                  <>{" "}<span title={tooltipForVolatility(p.volatility)}>{volStr}</span></>
                )}
                {deltaStr && (
                  <>{" "}<span title={tooltipForBestImpDelta(p.bestImpDelta, p.bestBook)}>{deltaStr}</span></>
                )}
                {p.staleRowTag === "soft_line" && (
                  <span title={tooltipForStaleTag(p.staleRowTag, p.bestBook, p.staleRowDelta)} style={{ color: "var(--ws-positive)", marginLeft: 6 }}>SOFT</span>
                )}
                {p.staleRowTag === "stale_line" && (
                  <span title={tooltipForStaleTag(p.staleRowTag, p.bestBook, p.staleRowDelta)} style={{ color: "var(--ws-warn)", marginLeft: 6 }}>STALE</span>
                )}
              </div>
            )}
            {p.reasoning && (
              <div className="ws-feat-reason">{p.reasoning}</div>
            )}
            {p.processNote && (
              <div className="ws-feat-reason" style={{ fontStyle: "italic", opacity: 0.85 }} title={tooltipForProcessNote(p.processNote)}>
                — {p.processNote}
              </div>
            )}
            {p.avoidReason && (
              <div className="ws-feat-reason" style={{ fontStyle: "italic", color: "var(--ws-warn)" }} title={tooltipForAvoidReason(p.avoidReason)}>
                ⚠ {p.avoidReason}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
