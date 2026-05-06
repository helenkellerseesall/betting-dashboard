import type { FeaturedPlay } from "../types"
import { useBuilder } from "../builderContext"
import { fmtOdds, compactStat, teamAbbrev } from "../utils"

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
        return (
          <div key={p.id || `${p.player}-${i}`} className="ws-feat-row" title={p.processNote || ""}>
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
            {p.reasoning ? (
              <div className="ws-feat-reason">{p.reasoning}{p.processNote ? <em> — {p.processNote}</em> : null}</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
