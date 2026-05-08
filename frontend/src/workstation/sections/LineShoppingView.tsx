import { useMemo, useState } from "react"
import type { SportState } from "../types"
import { fmtOdds, compactStat, teamAbbrev } from "../utils"
import { Badge } from "../components/Badges"

export function LineShoppingView({ state }: { state: SportState | null }) {
  const [q, setQ] = useState("")
  const [stat, setStat] = useState("")
  const [flag, setFlag] = useState("")
  const [sort, setSort] = useState<"impSpread" | "spread" | "best">("impSpread")

  const groups = state?.lineShopping?.groups || []

  const { rows, statOptions } = useMemo(() => {
    const stats = new Set<string>()
    for (const g of groups) {
      const f = String(g.statFamily || "").toLowerCase()
      if (f) stats.add(f)
    }
    let r = groups.filter((g) => {
      if (q) {
        const hay = `${g.player || ""} ${g.team || ""}`.toLowerCase()
        if (!hay.includes(q.toLowerCase())) return false
      }
      if (stat && String(g.statFamily || "").toLowerCase() !== stat) return false
      if (flag && !(g.flags || []).includes(flag)) return false
      return true
    })
    r = [...r].sort((a, b) => {
      if (sort === "impSpread") {
        return Number(b.impliedSpread ?? 0) - Number(a.impliedSpread ?? 0)
      }
      if (sort === "spread") return Number(b.oddsSpread ?? 0) - Number(a.oddsSpread ?? 0)
      return Number(b.bestOdds ?? 0) - Number(a.bestOdds ?? 0)
    })
    return { rows: r.slice(0, 200), statOptions: [...stats].sort() }
  }, [groups, q, stat, flag, sort])

  if (!state) return <div className="ws-empty">Loading…</div>

  const totalGroups = groups.length
  const sport = state.sport

  return (
    <div>
      <h2 className="ws-section-title">👁️ Book Radar <small>{rows.length} props across multiple books</small></h2>
      {totalGroups === 0 ? (
        <div className="ws-card" style={{ marginBottom: 14 }}>
          <strong>No multi-book props yet</strong>
          <div className="ws-trust-note" style={{ marginTop: 6 }}>
            {sport === "nba"
              ? "NBA market may be single-book right now. Multi-book groups appear once two or more sportsbooks post the same prop — check back after lines open up."
              : "No multi-book coverage for this slate yet. Reload after the next ingest pass or once books post their full cards."}
          </div>
        </div>
      ) : null}

      <div className="ws-filters">
        <input className="ws-input" placeholder="Player or team…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
        <select className="ws-select" value={stat} onChange={(e) => setStat(e.target.value)}>
          <option value="">All stats</option>
          {statOptions.map((s) => <option key={s} value={s}>{compactStat(s)}</option>)}
        </select>
        <select className="ws-select" value={flag} onChange={(e) => setFlag(e.target.value)}>
          <option value="">All</option>
          <option value="soft_book">Soft books</option>
          <option value="stale_line">Stale lines</option>
          <option value="market_disagreement">Disagreement</option>
        </select>
        <select className="ws-select" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="impSpread">Sort: Implied Edge</option>
          <option value="spread">Sort: Raw Spread</option>
          <option value="best">Sort: Best Odds</option>
        </select>
      </div>

      <div className="ws-table-wrap">
        <table className="ws-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Tm</th>
              <th>Stat</th>
              <th>Side</th>
              <th className="num">Line</th>
              <th>Best Book</th>
              <th className="num">Best</th>
              <th>Worst Book</th>
              <th className="num">Worst</th>
              <th className="num" title="Implied probability spread — the actionable edge">Imp Δ</th>
              <th className="num" title="Raw American odds spread (display only)">Spread</th>
              <th className="num">Books</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.propGroupKey}>
                <td className="ws-text-strong">{g.player || "—"}</td>
                <td className="ws-dim">{teamAbbrev(g.team)}</td>
                <td>{compactStat(g.statFamily)}</td>
                <td>{g.side}</td>
                <td className="num">{g.line ?? ""}</td>
                <td className="ws-pos">{g.bestBook || ""}</td>
                <td className="num ws-text-strong">{fmtOdds(g.bestOdds)}</td>
                <td className="ws-dim">{g.worstBook || ""}</td>
                <td className="num ws-dim">{fmtOdds(g.worstOdds)}</td>
                <td className="num ws-text-strong">
                  {g.impliedSpread != null
                    ? `${(g.impliedSpread * 100).toFixed(1)}%`
                    : ""}
                </td>
                <td className="num ws-dim">{g.oddsSpread ?? ""}</td>
                <td className="num">{g.bookCount}</td>
                <td>
                  <div className="ws-row" style={{ gap: 4, flexWrap: "wrap" }}>
                    {(g.flags || []).map((f) => (
                      <Badge
                        key={f}
                        kind={f === "soft_book" ? "softbook" : f === "stale_line" ? "stale" : ""}
                      >
                        {f}
                      </Badge>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
