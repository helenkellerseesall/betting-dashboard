import { useEffect, useState } from "react"
import type { SportState } from "../types"
import { api } from "../api"
import { fmtOdds, fmtPct, teamAbbrev } from "../utils"
import { useBuilder } from "../builderContext"

export function FirstBasketView({ state }: { state: SportState | null }) {
  const [data, setData] = useState<{ supported: boolean; plays: any[] } | null>(null)
  const builder = useBuilder()

  useEffect(() => {
    if (!state) return
    let cancelled = false
    api.firstBasket(state.sport, state.date)
      .then((r) => { if (!cancelled) setData({ supported: r.supported, plays: r.plays || [] }) })
      .catch(() => { if (!cancelled) setData({ supported: false, plays: [] }) })
    return () => { cancelled = true }
  }, [state?.sport, state?.date])

  if (!state) return <div className="ws-empty">Loading…</div>

  // ── MLB dead state ───────────────────────────────────────────────────────────
  if (state.sport !== "nba") {
    return (
      <div>
        <h2 className="ws-section-title">🏀 First Basket <small>NBA only</small></h2>
        <div className="ws-card" style={{ marginBottom: 14 }}>
          <strong>MLB slate active — First Basket is an NBA market.</strong>
          <div className="ws-trust-note" style={{ marginTop: 6 }}>
            First basket props only exist in NBA games. Flip to NBA in the header to access
            tip-edge, opening-script, and first-touch probabilities.
            For tonight's MLB action, head to <strong>Tonight's Edge</strong> or <strong>Full Slate</strong>.
          </div>
        </div>
      </div>
    )
  }

  const plays: any[] = data?.plays || []
  const hero = plays[0] ?? null
  const rest  = plays.slice(1)

  const topOdds  = hero ? (hero.oddsAmerican ?? hero.odds) : null
  const topEdge  = hero ? Number(hero.edge ?? hero.edgeProbability ?? 0) : 0
  const eliteCount = plays.filter((p) =>
    (p.tier || p.confidenceTier || "").toUpperCase().includes("ELITE")
  ).length

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <h2 className="ws-section-title">
        🏀 First Basket
        <small>NBA · {state.date}</small>
      </h2>

      {/* ── Pipeline context strip ──────────────────────────────────────────── */}
      <div className="ws-risk-pulse" style={{ marginBottom: 14 }}>
        <span className="ws-mood-pill neutral">
          ● {plays.length} candidate{plays.length !== 1 ? "s" : ""}
        </span>
        {eliteCount > 0 && (
          <span className="ws-dim" style={{ fontSize: 12 }}>
            {eliteCount} ELITE tier
          </span>
        )}
        <span className="ws-dim" style={{ fontSize: 11, fontStyle: "italic" }}>
          Pipeline: tip-win × first-touch × shot-make probability chain
        </span>
      </div>

      {/* ── Loading / empty states ──────────────────────────────────────────── */}
      {!data && (
        <div className="ws-loading">Loading first basket candidates…</div>
      )}

      {data && !plays.length && (
        <div className="ws-feat-card" style={{ marginBottom: 14 }}>
          <div className="ws-feat-empty" style={{ padding: "18px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>🏀</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>No first basket plays tonight</div>
            <div className="ws-dim" style={{ fontSize: 12, maxWidth: 340 }}>
              Either the slate has no FB markets yet, or all candidates were filtered
              as low-confidence by the opening-script engine. Check back closer to tip-off.
            </div>
          </div>
        </div>
      )}

      {/* ── Hero play ───────────────────────────────────────────────────────── */}
      {hero && (
        <div className="ws-fb-hero" style={{ marginBottom: 14 }}>
          <div className="ws-fb-hero-badge">🏀 TOP OPENER</div>

          <div className="ws-fb-hero-body">
            <div className="ws-fb-hero-left">
              <div className="ws-fb-hero-player">{hero.player}</div>
              {hero.team && (
                <div className="ws-dim" style={{ fontSize: 13, marginTop: 2 }}>
                  {teamAbbrev(hero.team)}
                  {hero.matchup ? <span style={{ marginLeft: 6 }}>· {hero.matchup}</span> : null}
                </div>
              )}
              <div className="ws-fb-hero-prop">
                {hero.side === "yes" ? "First basket scorer" : hero.side}
                {hero.propType && hero.propType !== hero.side
                  ? <span className="ws-dim"> · {hero.propType}</span>
                  : null}
              </div>

              {/* Narrative if available */}
              {(hero.attackNote || hero.reasoning) && (
                <div className="ws-spotlight-attack" style={{ marginTop: 8, maxWidth: 480 }}>
                  {hero.attackNote || hero.reasoning}
                </div>
              )}
            </div>

            <div className="ws-fb-hero-right">
              <div className="ws-fb-hero-odds">{fmtOdds(topOdds)}</div>
              {topEdge > 0 && (
                <div className="ws-pos" style={{ fontSize: 13, fontFamily: "var(--ws-mono)" }}>
                  +{(topEdge * 100).toFixed(1)}% edge
                </div>
              )}
              {hero.modelProb != null && (
                <div className="ws-dim" style={{ fontSize: 12, fontFamily: "var(--ws-mono)" }}>
                  model {fmtPct(Number(hero.modelProb ?? hero.predictedProbability ?? 0))}
                </div>
              )}
              {hero.sportsbook || hero.book ? (
                <div className="ws-dim" style={{ fontSize: 11, marginTop: 4 }}>
                  {hero.sportsbook || hero.book}
                </div>
              ) : null}
              <TierBadge tier={hero.tier || hero.confidenceTier} />
              <button
                className="ws-btn ws-btn-primary"
                style={{ fontSize: 12, marginTop: 10 }}
                onClick={() => builder.addLegFromCandidate(hero)}
              >
                + Add to builder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rest of the board ───────────────────────────────────────────────── */}
      {rest.length > 0 && (
        <div className="ws-feat-card" style={{ marginBottom: 14 }}>
          <div className="ws-feat-head">
            <span className="ws-feat-icon">📋</span>
            <span className="ws-feat-title">Full First Basket Board</span>
            <span className="ws-feat-count">{rest.length} more</span>
          </div>

          <div className="ws-fb-rest">
            {rest.map((p: any, i: number) => (
              <div key={p.id || i} className="ws-fb-rest-row">
                <span className="ws-feat-rank">{i + 2}.</span>
                <div className="ws-fb-rest-body">
                  <span className="ws-feat-name">{p.player}</span>
                  {p.team && (
                    <span className="ws-dim" style={{ fontSize: 11 }}> {teamAbbrev(p.team)}</span>
                  )}
                  {(p.side && p.side !== "yes") && (
                    <span className="ws-dim" style={{ fontSize: 11 }}> · {p.side}</span>
                  )}
                </div>
                <span style={{ fontFamily: "var(--ws-mono)", fontSize: 13 }}>
                  {fmtOdds(p.oddsAmerican ?? p.odds)}
                </span>
                {Number(p.edge ?? 0) > 0 && (
                  <span className="ws-pos" style={{ fontSize: 11, fontFamily: "var(--ws-mono)" }}>
                    +{(Number(p.edge ?? 0) * 100).toFixed(1)}%
                  </span>
                )}
                <TierBadge tier={p.tier || p.confidenceTier} compact />
                <span className="ws-dim" style={{ fontSize: 11 }}>
                  {p.sportsbook || p.book || ""}
                </span>
                <button
                  className="ws-btn ws-btn-icon"
                  style={{ padding: "1px 5px" }}
                  onClick={() => builder.addLegFromCandidate(p)}
                >+</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Pipeline note ───────────────────────────────────────────────────── */}
      {plays.length > 0 && (
        <div className="ws-trust-note" style={{ marginBottom: 10 }}>
          Model scores each candidate through a sequential probability chain:
          tip-win → first-touch → first-shot → make. Edge is vs. implied book odds.
          ELITE tier = all four factors aligned with positive process indicators.
        </div>
      )}
    </div>
  )
}

/* ── Tier badge ──────────────────────────────────────────────────────────── */
function TierBadge({ tier, compact = false }: { tier?: string; compact?: boolean }) {
  if (!tier) return null
  const t = String(tier).toUpperCase()
  const isElite   = t.includes("ELITE")
  const isStrong  = t.includes("STRONG")
  const isLotto   = t.includes("LOTTO")
  const isFade    = t.includes("FADE")
  const color = isElite  ? "var(--ws-tier-elite)"
              : isStrong ? "var(--ws-positive)"
              : isLotto  ? "var(--ws-vol-aggressive)"
              : isFade   ? "var(--ws-neg)"
              : "var(--ws-dim)"
  return (
    <span style={{
      fontSize: compact ? 10 : 11,
      fontWeight: 600,
      color,
      fontFamily: "var(--ws-mono)",
      letterSpacing: "0.03em",
      marginTop: compact ? 0 : 4,
    }}>
      {t.split("_")[0]}
    </span>
  )
}
