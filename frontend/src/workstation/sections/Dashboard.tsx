import type { SportState, FeaturedPlay } from "../types"
import { FeaturedCard } from "../components/FeaturedCard"
import { fmtOdds, compactStat, teamAbbrev } from "../utils"
import { useBuilder } from "../builderContext"

/**
 * Dashboard — the workstation command center.
 *
 * Answers the question: "What should I focus on tonight?"
 *
 * Layout:
 *   1. Snapshot strip (sport, date, candidate count, mood)
 *   2. Tonight's Best — the trust-anchor bucket (multi-factor curated)
 *   3. Featured grid (HRs, ladders, smart aggression, safest, CLV, market, timing, books)
 *   4. Portfolio mood pill + concise actionable warnings (no F grades)
 */
export function Dashboard({ state }: { state: SportState | null }) {
  if (!state) return <div className="ws-empty">Loading slate…</div>
  const { counts, portfolio, aiSlips, featured, sport, date } = state

  const aiCount =
    aiSlips.safe.length + aiSlips.balanced.length +
    aiSlips.aggressive.length + aiSlips.lotto.length

  const ringPct = Math.max(0, Math.min(100, portfolio?.score ?? 0))
  const moodTone = portfolio?.mood?.tone || "neutral"
  const moodHeadline = portfolio?.mood?.headline || (portfolio?.grade ?? "Portfolio")

  const anchors      = featured?.anchors || []
  const tonightsBest = featured?.tonightsBest || []
  const curatedCount = featured?.summary
    ? (featured.summary.match(/(\d+)\s+curated plays/)?.[1] ?? `${anchors.length + tonightsBest.length}`)
    : `${anchors.length + tonightsBest.length}`

  return (
    <div>
      <h2 className="ws-section-title">
        Command Center <small>{sport.toUpperCase()} · {date}</small>
      </h2>

      {/* Snapshot strip */}
      <div className="ws-grid ws-grid-4" style={{ marginBottom: 14 }}>
        <KpiCard label="Anchors"         value={`${anchors.length}`} sub={`${curatedCount} curated plays total`} />
        <KpiCard label="AI Slips"        value={`${aiCount}`}            sub={`safe:${aiSlips.safe.length} bal:${aiSlips.balanced.length} aggr:${aiSlips.aggressive.length} lotto:${aiSlips.lotto.length}`} />
        <KpiCard label="Urgent / Stale"  value={`${counts.urgent}`}      sub={`${counts.steam} steam · ${counts.stale} stale windows`} />
        <KpiCard label="Multi-book Props" value={`${counts.propsWithMultiBook}`} sub="line shopping pool" />
      </div>

      {/* Portfolio mood + concise warnings */}
      <div className="ws-card" style={{ marginBottom: 14 }}>
        <div className="ws-row-between" style={{ marginBottom: 8 }}>
          <div className="ws-row" style={{ gap: 10 }}>
            <strong>Portfolio</strong>
            <span className={`ws-mood-pill ${moodTone}`}>● {moodHeadline}</span>
            <span className="ws-dim">score {ringPct}/100 · {portfolio?.grade ?? "—"}</span>
          </div>
        </div>
        {(portfolio?.warnings && portfolio.warnings.length) ? (
          <div className="ws-row" style={{ gap: 10, flexWrap: "wrap", fontSize: 12 }}>
            {portfolio.warnings.slice(0, 4).map((w, i) => {
              const text = typeof w === "string" ? w : w.label
              const lvl  = typeof w === "string" ? "moderate" : w.level
              const icon = lvl === "high" ? "⚠️" : "🔶"
              return (
                <span key={i} style={{ color: "var(--ws-text-dim)" }}>{icon} {text}</span>
              )
            })}
          </div>
        ) : (
          <div className="ws-trust-note">Portfolio looks balanced — no concentration warnings to surface.</div>
        )}
      </div>

      {/* Anchors — the nightly trust tier (3-5 plays only) */}
      <div style={{ marginBottom: 14 }}>
        <AnchorCard plays={anchors} />
      </div>

      {/* Strong supports — second tier */}
      {!!tonightsBest.length && (
        <div style={{ marginBottom: 14 }}>
          <FeaturedCard
            icon="💎"
            title="Strong Supports"
            plays={tonightsBest}
            emptyMessage=""
            maxRows={5}
          />
        </div>
      )}

      {/* Featured grid */}
      <div className="ws-featured-grid">
        <FeaturedCard
          icon="💣"
          title="Best HR Spots"
          plays={featured?.bestHr || []}
          emptyMessage={sport === "mlb" ? "No HR plays cleared the trust filters tonight." : "HR plays are MLB-only."}
        />
        <FeaturedCard
          icon="📈"
          title="Best Ladder Spots"
          plays={featured?.bestLadders || []}
          emptyMessage="No ladder plays meet the threshold — markets may be tightly priced."
        />
        <FeaturedCard
          icon="🎯"
          title="Smart Aggression"
          plays={featured?.smartAggression || []}
          emptyMessage="No aggressive plays clear the archetype-trust threshold."
        />
        <FeaturedCard
          icon="🛟"
          title="Safest Plays"
          plays={featured?.safest || []}
          emptyMessage="Slate is light on low-volatility plays — variance night."
        />
        <FeaturedCard
          icon="📊"
          title="Best CLV Opportunities"
          plays={featured?.bestClv || []}
          emptyMessage="CLV trust requires more historical data — keep logging bets."
        />
        <FeaturedCard
          icon="🤝"
          title="Strongest Market Agreement"
          plays={featured?.marketAgreement || []}
          emptyMessage="No multi-book consensus picks meet the threshold yet."
        />
        <FeaturedCard
          icon="⏱"
          title="Best Timing Windows"
          plays={featured?.timingWindows || []}
          emptyMessage="No urgent / stale-window plays right now."
        />
        <BestBooksCard books={featured?.bestBooks || []} />
      </div>
    </div>
  )
}

/**
 * AnchorCard — premium display for the 3-5 highest-trust nightly plays.
 * Renders the attack note prominently so each anchor reads as a specific
 * reason to act, not just a stat ranking.
 */
function AnchorCard({ plays }: { plays: FeaturedPlay[] }) {
  const builder = useBuilder()

  if (!plays.length) {
    return (
      <div className="ws-feat-card">
        <div className="ws-feat-head">
          <span className="ws-feat-icon">⚡</span>
          <span className="ws-feat-title">Tonight's Anchors</span>
          <span className="ws-feat-count">0 picks</span>
        </div>
        <div className="ws-feat-empty">
          No anchor-tier plays cleared the corroboration filters yet — slate may be light or markets unsettled.
        </div>
      </div>
    )
  }

  return (
    <div className="ws-feat-card ws-anchor-card">
      <div className="ws-feat-head">
        <span className="ws-feat-icon">⚡</span>
        <span className="ws-feat-title">Tonight's Anchors</span>
        <span className="ws-feat-count">{plays.length} pick{plays.length === 1 ? "" : "s"}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--ws-text-dim)", padding: "2px 10px 6px", borderBottom: "1px solid var(--ws-border)" }}>
        Strict gate: composite score + corroboration (CLV · archetype · timing · market). Your highest-conviction starting points.
      </div>
      {plays.map((p, i) => {
        const team = teamAbbrev(p.team)
        const urgentBadge = p.timingUrgency === "immediate" ? "⏱" : p.timingState === "stale_window" ? "📌" : null
        return (
          <div key={p.id || i} className="ws-anchor-row">
            <div className="ws-anchor-rank">{i + 1}</div>
            <div className="ws-anchor-body">
              <div className="ws-anchor-top">
                <span className="ws-anchor-player">{p.player}</span>
                {team ? <span className="ws-anchor-team"> {team}</span> : null}
                {urgentBadge ? <span className="ws-anchor-urgent" title={p.timingUrgency}> {urgentBadge}</span> : null}
                <span className="ws-anchor-prop">
                  {" · "}{compactStat(p.statFamily)} {p.side} {p.line ?? ""}
                </span>
                <span className="ws-anchor-odds">{fmtOdds(p.odds)}</span>
                <span className="ws-anchor-book">{p.bestBook || p.book || "—"}</span>
                <button
                  className="ws-btn ws-btn-icon"
                  title="Add leg to bet builder"
                  onClick={() =>
                    builder.addLegFromCandidate({
                      id: p.id, player: p.player, team: p.team, eventId: p.eventId,
                      matchup: p.matchup, statFamily: p.statFamily, propType: p.propType,
                      side: p.side, line: p.line, odds: p.odds, book: p.book,
                      modelProb: p.modelProb, edge: p.edge,
                    })
                  }
                >+</button>
              </div>
              {p.attackNote && (
                <div className="ws-anchor-attack">{p.attackNote}</div>
              )}
              {p.reasoning && (
                <div className="ws-anchor-tags">{p.reasoning}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ws-kpi">
      <div className="ws-kpi-label">{label}</div>
      <div className="ws-kpi-value">{value}</div>
      {sub ? <div className="ws-kpi-sub">{sub}</div> : null}
    </div>
  )
}

function BestBooksCard({ books }: { books: { book: string; plays: number; avgScore: number; topPlay?: FeaturedPlay | null }[] }) {
  return (
    <div className="ws-feat-card">
      <div className="ws-feat-head">
        <span className="ws-feat-icon">🏦</span>
        <span className="ws-feat-title">Best Books Tonight</span>
        <span className="ws-feat-count">{books.length} ranked</span>
      </div>
      {!books.length && <div className="ws-feat-empty">No book ranking — line shopping data still warming up.</div>}
      {books.slice(0, 5).map((b, i) => (
        <div key={b.book} className="ws-feat-row" style={{ gridTemplateColumns: "16px 1fr auto auto" }}>
          <span className="ws-feat-rank">{i + 1}.</span>
          <span>
            <span className="ws-feat-name">{b.book}</span>
            {b.topPlay ? (
              <div className="ws-feat-prop">
                top: {b.topPlay.player} · {compactStat(b.topPlay.statFamily)} {b.topPlay.side} {b.topPlay.line ?? ""} {fmtOdds(b.topPlay.odds)}
              </div>
            ) : null}
          </span>
          <span className="ws-feat-meta">{b.plays} play{b.plays === 1 ? "" : "s"}</span>
          <span className="ws-feat-meta">{Math.round((b.avgScore || 0) * 100)}</span>
        </div>
      ))}
    </div>
  )
}
