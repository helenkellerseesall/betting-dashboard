import { useMemo, useState } from "react"
import type { SportState, Candidate, TimingClassification, LineShopGroup } from "../types"
import { CandidateBadges } from "../components/Badges"
import { fmtOdds, fmtPct, teamAbbrev, compactStat } from "../utils"
import { useBuilder } from "../builderContext"

const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s_]+/g, "")

function buildKey(c: Candidate): string {
  return [
    String(c.eventId || ""),
    String(c.player || "").toLowerCase().trim(),
    norm(c.statFamily || c.propType || ""),
    String(c.side || "").toLowerCase(),
    String(c.line ?? "any"),
  ].join("|")
}

function shortKey(c: Candidate): string {
  return buildKey(c).split("|").slice(1).join("|")
}

export function SlateBrowser({ state }: { state: SportState | null }) {
  const [q, setQ] = useState("")
  const [stat, setStat] = useState("")
  const [book, setBook] = useState("")
  const [side, setSide] = useState("")
  const [tier, setTier] = useState("")
  const [sort, setSort] = useState<"edge" | "odds" | "modelProb">("edge")

  const builder = useBuilder()

  const { rows, statOptions, bookOptions, lookups } = useMemo(() => {
    const candidates = state?.candidates || []
    const stats = new Set<string>()
    const books = new Set<string>()
    for (const c of candidates) {
      const fam = norm(c.statFamily || c.propType || "")
      if (fam) stats.add(fam)
      const b = (c.book || c.sportsbook || "").toLowerCase()
      if (b) books.add(b)
    }
    // Lookup maps for timing + line shopping
    const timingMap = new Map<string, TimingClassification>()
    for (const tc of state?.timing?.classifications || []) {
      timingMap.set([
        String(tc.eventId || ""),
        String(tc.player || "").toLowerCase().trim(),
        norm(tc.statFamily || ""),
        String(tc.side || "").toLowerCase(),
        String(tc.line ?? "any"),
      ].join("|"), tc)
    }
    const shopMap = new Map<string, LineShopGroup>()
    for (const g of state?.lineShopping?.groups || []) {
      shopMap.set([
        String(g.player || "").toLowerCase().trim(),
        norm(g.statFamily || ""),
        String(g.side || "").toLowerCase(),
        String(g.line ?? "any"),
      ].join("|"), g)
    }
    function lookupTiming(c: Candidate) {
      const full = buildKey(c)
      const direct = timingMap.get(full)
      if (direct) return direct
      const short = full.split("|").slice(1).join("|")
      for (const [k, v] of timingMap) {
        if (k.split("|").slice(1).join("|") === short) return v
      }
      return null
    }
    function lookupShop(c: Candidate) {
      return shopMap.get(shortKey(c)) || null
    }

    const filtered = candidates.filter((c) => {
      if (q) {
        const hay = `${c.player || ""} ${c.team || ""} ${c.matchup || ""}`.toLowerCase()
        if (!hay.includes(q.toLowerCase())) return false
      }
      if (stat && norm(c.statFamily || c.propType || "") !== stat) return false
      if (book && (c.book || c.sportsbook || "").toLowerCase() !== book) return false
      if (side && String(c.side || "").toLowerCase() !== side) return false
      if (tier && String(c.tier || c.confidenceTier || "").toUpperCase() !== tier) return false
      return true
    })

    const sorted = [...filtered].sort((a, b) => {
      const av = sort === "edge" ? Number(a.edge ?? a.edgeProbability ?? 0)
              : sort === "modelProb" ? Number(a.modelProb ?? a.predictedProbability ?? 0)
              : Number(a.odds ?? 0)
      const bv = sort === "edge" ? Number(b.edge ?? b.edgeProbability ?? 0)
              : sort === "modelProb" ? Number(b.modelProb ?? b.predictedProbability ?? 0)
              : Number(b.odds ?? 0)
      return bv - av
    })

    return {
      rows: sorted.slice(0, 250),
      statOptions: [...stats].sort(),
      bookOptions: [...books].sort(),
      lookups: { lookupTiming, lookupShop },
    }
  }, [state, q, stat, book, side, tier, sort])

  if (!state) return <div className="ws-empty">Loading…</div>

  return (
    <div>
      <h2 className="ws-section-title">
        Live Slate Browser <small>{rows.length} of {state.candidates.length} plays</small>
      </h2>

      <div className="ws-filters">
        <input className="ws-input" placeholder="Player, team, matchup…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
        <select className="ws-select" value={stat} onChange={(e) => setStat(e.target.value)}>
          <option value="">All stats</option>
          {statOptions.map((s) => <option key={s} value={s}>{compactStat(s)}</option>)}
        </select>
        <select className="ws-select" value={book} onChange={(e) => setBook(e.target.value)}>
          <option value="">All books</option>
          {bookOptions.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="ws-select" value={side} onChange={(e) => setSide(e.target.value)}>
          <option value="">All sides</option>
          <option value="over">Over</option>
          <option value="under">Under</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
        <select className="ws-select" value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="">All tiers</option>
          <option value="ELITE">Elite</option>
          <option value="STRONG">Strong</option>
          <option value="PLAYABLE">Playable</option>
          <option value="LOTTO">Lotto</option>
        </select>
        <select className="ws-select" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="edge">Sort: Edge</option>
          <option value="modelProb">Sort: Model %</option>
          <option value="odds">Sort: Odds</option>
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
              <th className="num">Odds</th>
              <th>Book</th>
              <th className="num">Model</th>
              <th className="num">Edge</th>
              <th>Signals</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const tc = lookups.lookupTiming(c)
              const ls = lookups.lookupShop(c)
              const id = buildKey(c)
              const added = builder.isLegAdded(id)
              const edge = Number(c.edge ?? c.edgeProbability ?? 0)
              return (
                <tr key={id + (c.book || "")}>
                  <td className="ws-text-strong">{c.player}</td>
                  <td className="ws-dim">{teamAbbrev(c.team)}</td>
                  <td>{compactStat(c.statFamily || c.propType)}</td>
                  <td>{c.side}</td>
                  <td className="num">{c.line ?? ""}</td>
                  <td className="num ws-text-strong">{fmtOdds(c.odds ?? c.oddsAmerican)}</td>
                  <td className="ws-dim">{c.book || c.sportsbook || ""}</td>
                  <td className="num">{fmtPct(Number(c.modelProb ?? c.predictedProbability ?? 0))}</td>
                  <td className={"num " + (edge >= 0 ? "ws-pos" : "ws-neg")}>{fmtPct(edge)}</td>
                  <td><div className="ws-row" style={{ gap: 4, flexWrap: "wrap" }}><CandidateBadges c={c} tc={tc} ls={ls} /></div></td>
                  <td>
                    <button
                      className={added ? "ws-btn ws-btn-danger ws-btn-icon" : "ws-btn ws-btn-icon"}
                      onClick={() => added ? builder.removeLeg(id) : builder.addLegFromCandidate(c)}
                      title={added ? "Remove from builder" : "Add to builder"}
                    >
                      {added ? "−" : "+"}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
