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

  if (state.sport !== "nba") {
    return (
      <div>
        <h2 className="ws-section-title">First Basket Workstation <small>NBA only</small></h2>
        <div className="ws-empty">
          First basket intelligence is NBA-only. Switch to NBA in the header to access tip-edge,
          opening-script, and first-touch / first-shot probabilities.
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="ws-section-title">
        First Basket Workstation
        <small>{data?.plays.length || 0} candidates · NBA · {state.date}</small>
      </h2>

      <div className="ws-trust-note" style={{ marginBottom: 10 }}>
        Pipeline decomposes first-basket probability into tip-win × first-touch × first-shot|touch × make-shot.
        Use <strong>Smart Aggression</strong> on the dashboard for the highest-trust opener picks tonight.
      </div>

      {!data ? (
        <div className="ws-loading">Loading first basket data…</div>
      ) : !data.plays.length ? (
        <div className="ws-empty">
          No first basket props in tonight's pool. Either the slate has no FB markets yet,
          or all candidates were filtered as low-confidence by the engine.
        </div>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Tm</th>
                <th>Side</th>
                <th className="num">Odds</th>
                <th>Book</th>
                <th className="num">Model</th>
                <th className="num">Edge</th>
                <th>Tier</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.plays.map((p: any, i: number) => (
                <tr key={p.id || i}>
                  <td className="ws-text-strong">{p.player}</td>
                  <td className="ws-dim">{teamAbbrev(p.team)}</td>
                  <td>{p.side}</td>
                  <td className="num ws-text-strong">{fmtOdds(p.oddsAmerican ?? p.odds)}</td>
                  <td className="ws-dim">{p.sportsbook || p.book || ""}</td>
                  <td className="num">{fmtPct(Number(p.modelProb ?? p.predictedProbability ?? 0))}</td>
                  <td className={"num " + (Number(p.edge ?? 0) >= 0 ? "ws-pos" : "ws-neg")}>{fmtPct(Number(p.edge ?? p.edgeProbability ?? 0))}</td>
                  <td>{p.tier || p.confidenceTier || ""}</td>
                  <td>
                    <button className="ws-btn ws-btn-icon" onClick={() => builder.addLegFromCandidate(p)}>+</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
