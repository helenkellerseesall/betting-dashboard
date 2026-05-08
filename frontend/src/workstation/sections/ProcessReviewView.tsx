import { useEffect, useState } from "react"
import { api } from "../api"
import { fmtPct, fmtNum } from "../utils"

export function ProcessReviewView() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    api.ledger(days)
      .then((r) => { if (!cancelled) setData(r) })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)) })
    return () => { cancelled = true }
  }, [days])

  return (
    <div>
      <h2 className="ws-section-title">
        📈 Edge Log <small>{days}-day window</small>
      </h2>

      <div className="ws-filters">
        {[7, 14, 30, 60, 90].map((d) => (
          <button key={d} className={`ws-pill ${days === d ? "active" : ""}`} onClick={() => setDays(d)}>{d}d</button>
        ))}
      </div>

      {error && <div className="ws-card" style={{ color: "var(--ws-negative)" }}>Error: {error}</div>}
      {!data && !error && <div className="ws-loading">Loading ledger…</div>}

      {data && (
        <>
          <div className="ws-grid ws-grid-4" style={{ marginBottom: 14 }}>
            <KPI label="Bankroll"   value={data.bankroll?.current != null ? `$${fmtNum(data.bankroll.current, 2)}` : "—"} sub={data.bankroll?.starting != null ? `started at $${fmtNum(data.bankroll.starting, 2)}` : ""} />
            <KPI label="P&L"        value={data.totals?.profit != null ? `${data.totals.profit >= 0 ? "+" : ""}$${fmtNum(data.totals.profit, 2)}` : "—"} sub={data.totals?.bets ? `${data.totals.bets} bets placed` : ""} />
            <KPI label="ROI"        value={data.totals?.roi != null ? fmtPct(data.totals.roi, 1) : "—"} sub={data.totals?.winRate != null ? `${fmtPct(data.totals.winRate, 1)} win rate` : ""} />
            <KPI label="CLV Alpha"  value={data.report?.clv?.avgClv != null ? `${(data.report.clv.avgClv * 100).toFixed(2)}¢` : "—"} sub={data.report?.clv?.beatRate != null ? `beat closing line ${fmtPct(data.report.clv.beatRate, 1)}` : ""} />
          </div>

          <div className="ws-grid ws-grid-2" style={{ marginBottom: 14 }}>
            <div className="ws-card">
              <strong>Process Quality</strong>
              <div className="ws-stack" style={{ marginTop: 8 }}>
                <Row label="Good process losses (variance)" value={data.report?.process?.goodProcessLosses ?? 0} />
                <Row label="Lucky wins (negative CLV)" value={data.report?.process?.luckyWins ?? 0} />
                <Row label="Quality wins (positive CLV)" value={data.report?.process?.qualityWins ?? 0} />
              </div>
            </div>
            <div className="ws-card">
              <strong>By Stat</strong>
              <div className="ws-stack" style={{ marginTop: 8, maxHeight: 220, overflow: "auto" }}>
                {(Object.entries(data.report?.byStat || {}) as any).map(([k, v]: any) => (
                  <Row key={k} label={k.toUpperCase()} value={`${v.bets} bets · ${fmtPct(v.roi, 1)} ROI`} />
                ))}
                {!Object.keys(data.report?.byStat || {}).length && <div className="ws-empty">No stats yet.</div>}
              </div>
            </div>
          </div>

          <div className="ws-card">
            <strong>Recent Action</strong>
            <div className="ws-table-wrap" style={{ marginTop: 8 }}>
              <table className="ws-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Sport</th>
                    <th>Player</th>
                    <th>Bet</th>
                    <th className="num">Stake</th>
                    <th className="num">Odds</th>
                    <th>Result</th>
                    <th className="num">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.recent || []).map((b: any) => (
                    <tr key={b.id}>
                      <td className="ws-dim">{b.date}</td>
                      <td>{b.sport}</td>
                      <td>{b.player}</td>
                      <td className="ws-dim">{b.statFamily} {b.side} {b.line}</td>
                      <td className="num">${fmtNum(b.stake, 2)}</td>
                      <td className="num">{b.oddsAmerican ?? b.odds}</td>
                      <td>
                        <span style={{ color: b.result === "win" ? "var(--ws-positive)" : b.result === "loss" ? "var(--ws-negative)" : "var(--ws-text-dim)" }}>
                          {b.result || "pending"}
                        </span>
                      </td>
                      <td className={"num " + (Number(b.profit ?? 0) >= 0 ? "ws-pos" : "ws-neg")}>
                        {b.profit != null ? `${b.profit >= 0 ? "+" : ""}$${fmtNum(b.profit, 2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                  {!(data.recent || []).length && <tr><td colSpan={8} className="ws-empty">No bets yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function KPI({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="ws-kpi">
      <div className="ws-kpi-label">{label}</div>
      <div className="ws-kpi-value">{value}</div>
      <div className="ws-kpi-sub">{sub || ""}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="ws-row-between" style={{ fontSize: 12 }}>
      <span className="ws-dim">{label}</span>
      <span className="ws-text-strong">{value}</span>
    </div>
  )
}
