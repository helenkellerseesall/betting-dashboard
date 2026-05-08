import type { FeaturedPlay } from "../types"
import { fmtOdds, compactStat, teamAbbrev } from "../utils"
import { useBuilder } from "../builderContext"

interface Props {
  icon: string
  title: string
  tagline?: string          // one-line bettor context below the title
  plays: FeaturedPlay[]
  emptyMessage?: string
  maxRows?: number
  accentColor?: string      // CSS color value for top-border accent
}

/**
 * SpotlightCard — a featured bucket card with narrative.
 * The #1 play gets large treatment with attackNote surfaced.
 * Secondary plays are compact scannable rows.
 *
 * Designed to replace FeaturedCard in the Dashboard grid.
 * FeaturedCard still exists for other views.
 */
export function SpotlightCard({
  icon,
  title,
  tagline,
  plays,
  emptyMessage,
  maxRows = 5,
  accentColor,
}: Props) {
  const builder = useBuilder()
  const top  = plays[0] ?? null
  const rest = plays.slice(1, maxRows)

  const cardStyle = accentColor
    ? ({ "--spotlight-accent": accentColor } as React.CSSProperties)
    : {}

  function addPlay(p: FeaturedPlay) {
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

  return (
    <div className="ws-spotlight-card" style={cardStyle}>
      {/* Card header */}
      <div className="ws-spotlight-head">
        <span className="ws-spotlight-icon">{icon}</span>
        <div className="ws-spotlight-titles">
          <span className="ws-spotlight-title">{title}</span>
          {tagline && <span className="ws-spotlight-tagline">{tagline}</span>}
        </div>
        <span className="ws-spotlight-count">{plays.length}</span>
      </div>

      {/* Empty state */}
      {!top && (
        <div className="ws-feat-empty">
          {emptyMessage || "Nothing surfaced in this bucket tonight."}
        </div>
      )}

      {/* Top play — featured treatment */}
      {top && (
        <div className="ws-spotlight-top">
          <div className="ws-spotlight-top-meta">
            <span className="ws-spotlight-top-name">{top.player}</span>
            {top.team && (
              <span className="ws-dim ws-spotlight-top-team"> {teamAbbrev(top.team)}</span>
            )}
            {top.timingUrgency === "immediate" && (
              <span className="ws-hot-label" style={{ marginLeft: 8 }}>LIVE</span>
            )}
          </div>

          <div className="ws-spotlight-top-prop">
            <span className="ws-spotlight-top-stat">
              {compactStat(top.statFamily)} {top.side}{top.line != null ? ` ${top.line}` : ""}
            </span>
            <span className="ws-spotlight-top-odds">{fmtOdds(top.odds)}</span>
            {top.bestBook && (
              <span className="ws-dim" style={{ fontSize: 11 }}>{top.bestBook}</span>
            )}
            {top.edge != null && top.edge > 0 && (
              <span className="ws-pos" style={{ fontSize: 11, fontFamily: "var(--ws-mono)" }}>
                +{(top.edge * 100).toFixed(1)}%
              </span>
            )}
          </div>

          {/* The narrative — what makes this play interesting */}
          {top.attackNote && (
            <div className="ws-spotlight-attack">{top.attackNote}</div>
          )}
          {!top.attackNote && top.reasoning && (
            <div className="ws-spotlight-reasoning">{top.reasoning}</div>
          )}

          <button
            className="ws-btn ws-btn-icon ws-spotlight-add"
            onClick={() => addPlay(top)}
          >
            + add
          </button>
        </div>
      )}

      {/* Secondary plays — compact scannable rows */}
      {rest.length > 0 && (
        <div className="ws-spotlight-rest">
          {rest.map((p, i) => (
            <div key={p.id || `${p.player}-${i}`} className="ws-spotlight-rest-row">
              <span className="ws-feat-rank">{i + 2}.</span>
              <span className="ws-spotlight-rest-name">{p.player}</span>
              <span className="ws-dim ws-spotlight-rest-stat">
                {compactStat(p.statFamily)} {p.side}{p.line != null ? ` ${p.line}` : ""}
              </span>
              <span className="ws-spotlight-rest-odds">{fmtOdds(p.odds)}</span>
              <button
                className="ws-btn ws-btn-icon"
                style={{ padding: "1px 5px" }}
                onClick={() => addPlay(p)}
              >+</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
