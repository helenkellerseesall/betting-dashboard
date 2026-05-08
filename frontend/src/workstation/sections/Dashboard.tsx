import type { SportState, FeaturedPlay, AiSlip, Featured } from "../types"
import { HeroPickCard } from "../components/HeroPickCard"
import { SpotlightCard } from "../components/SpotlightCard"
import { fmtOdds, fmtPct, compactStat, teamAbbrev } from "../utils"
import { useBuilder } from "../builderContext"

/**
 * Dashboard — the bettor's command center.
 *
 * Visual hierarchy:
 *   1. Snapshot strip — quick numbers
 *   2. Risk pulse — single-line portfolio mood
 *   3. HeroPickCard — ☢️ nuclear play, visually dominant
 *   4. Supporting picks — remaining anchors + tonight's best
 *   5. Spotlight grid — 8 emotionally-charged curated buckets
 *   6. Chaos Builder — best moon-shot parlay
 *   7. Best Books — book rankings
 */
export function Dashboard({ state }: { state: SportState | null }) {
  if (!state) return <div className="ws-empty">Loading slate…</div>

  const { counts, portfolio, aiSlips, featured, sport, date } = state

  const aiCount =
    aiSlips.safe.length + aiSlips.balanced.length +
    aiSlips.aggressive.length + aiSlips.lotto.length

  const moodTone     = portfolio?.mood?.tone || "neutral"
  const moodHeadline = portfolio?.mood?.headline || (portfolio?.grade ?? "Balanced")
  const ringPct      = Math.max(0, Math.min(100, portfolio?.score ?? 0))

  const anchors      = featured?.anchors      || []
  const tonightsBest = featured?.tonightsBest || []

  // Supporting picks = anchors 2-N + tonightsBest (deduplicated by id)
  const heroPlay          = anchors[0] ?? null
  const supportingAnchors = anchors.slice(1)
  const anchorIds         = new Set(supportingAnchors.map((p) => p.id))
  const supportingBest    = tonightsBest.filter((p) => !anchorIds.has(p.id)).slice(0, 4)
  const allSupporting     = [...supportingAnchors, ...supportingBest]

  // Chaos parlay = top lotto slip
  const chaosSlip: AiSlip | null = aiSlips.lotto[0] ?? null

  return (
    <div>
      {/* ── 1. Snapshot strip ───────────────────────────────────────────── */}
      <h2 className="ws-section-title">
        Tonight's Edge <small>{sport.toUpperCase()} · {date}</small>
      </h2>

      <div className="ws-grid ws-grid-4" style={{ marginBottom: 10 }}>
        <KpiCard
          label="Anchors"
          value={`${anchors.length}`}
          sub={`${featured?.summary?.match(/(\d+)\s+curated/)?.[1] ?? anchors.length + tonightsBest.length} curated plays`}
        />
        <KpiCard
          label="AI Parlays"
          value={`${aiCount}`}
          sub={`core:${aiSlips.safe.length} mix:${aiSlips.balanced.length} fire:${aiSlips.aggressive.length} moon:${aiSlips.lotto.length}`}
        />
        <KpiCard
          label="Live Calls"
          value={`${counts.urgent}`}
          sub={`${counts.steam} steam · ${counts.stale} stale windows`}
        />
        <KpiCard
          label="Book Coverage"
          value={`${counts.propsWithMultiBook}`}
          sub="props across 2+ books"
        />
      </div>

      {/* ── 2. Risk pulse — single compact line ─────────────────────────── */}
      <div className="ws-risk-pulse" style={{ marginBottom: 14 }}>
        <span className={`ws-mood-pill ${moodTone}`}>● {moodHeadline}</span>
        <span className="ws-dim" style={{ fontSize: 12 }}>score {ringPct}/100 · {portfolio?.grade ?? "—"}</span>
        {portfolio?.warnings?.length ? (
          <span className="ws-risk-warnings">
            {portfolio.warnings.slice(0, 3).map((w, i) => {
              const text = typeof w === "string" ? w : w.label
              const lvl  = typeof w === "string" ? "moderate" : w.level
              return (
                <span key={i} className="ws-risk-flag">
                  {lvl === "high" ? "⚠️" : "🔶"} {text}
                </span>
              )
            })}
          </span>
        ) : (
          <span className="ws-dim" style={{ fontSize: 11, fontStyle: "italic" }}>
            Risk profile balanced — no concentration flags.
          </span>
        )}
      </div>

      {/* ── 3. Nuclear Pick hero ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <HeroPickCard play={heroPlay} anchorCount={anchors.length} />
      </div>

      {/* ── 4. Supporting picks ──────────────────────────────────────────── */}
      {allSupporting.length > 0 && (
        <div className="ws-supporting-section" style={{ marginBottom: 18 }}>
          <div className="ws-supporting-label">Also Strong Tonight</div>
          <div className="ws-supporting-grid">
            {allSupporting.slice(0, 6).map((p, i) => (
              <SupportingRow key={p.id || i} play={p} rank={i + 2} />
            ))}
          </div>
        </div>
      )}

      {/* ── 5. Spotlight grid — sport-aware ─────────────────────────────── */}
      {sport === "nba"
        ? <NbaSpotlightGrid featured={featured} tonightsBest={tonightsBest} />
        : <MlbSpotlightGrid featured={featured} tonightsBest={tonightsBest} />
      }

      {/* ── 6. Chaos Builder ─────────────────────────────────────────────── */}
      <ChaosShotBlock slip={chaosSlip} />

      {/* ── 7. Best Books ────────────────────────────────────────────────── */}
      <BestBooksCard books={featured?.bestBooks || []} />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Supporting row — compact pick beneath the hero                              */
/* ─────────────────────────────────────────────────────────────────────────── */
function SupportingRow({ play: p, rank }: { play: FeaturedPlay; rank: number }) {
  const builder = useBuilder()
  const team = teamAbbrev(p.team)
  return (
    <div className="ws-supporting-row">
      <span className="ws-supporting-rank">{rank}</span>
      <div className="ws-supporting-body">
        <span className="ws-supporting-player">{p.player}</span>
        {team && <span className="ws-dim" style={{ fontSize: 11 }}> {team}</span>}
        <span className="ws-supporting-prop">
          {" · "}{compactStat(p.statFamily)} {p.side}{p.line != null ? ` ${p.line}` : ""}
        </span>
        {p.attackNote && (
          <div className="ws-supporting-attack">{p.attackNote}</div>
        )}
      </div>
      <span className="ws-supporting-odds">{fmtOdds(p.odds)}</span>
      <span className="ws-dim" style={{ fontSize: 11 }}>{p.bestBook || p.book || "—"}</span>
      <button
        className="ws-btn ws-btn-icon"
        title="Add to builder"
        onClick={() =>
          builder.addLegFromCandidate({
            id: p.id, player: p.player, team: p.team,
            eventId: p.eventId, matchup: p.matchup,
            statFamily: p.statFamily, propType: p.propType,
            side: p.side, line: p.line, odds: p.odds,
            book: p.book, modelProb: p.modelProb, edge: p.edge,
          })
        }
      >+</button>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ChaosShotBlock — best lotto parlay surfaced as a chaos spotlight            */
/* ─────────────────────────────────────────────────────────────────────────── */
function ChaosShotBlock({ slip }: { slip: AiSlip | null }) {
  const builder = useBuilder()

  if (!slip) {
    return (
      <div className="ws-chaos-block ws-chaos-empty" style={{ marginBottom: 14 }}>
        <span className="ws-chaos-label">🌙 CHAOS BUILDER</span>
        <span className="ws-dim" style={{ fontSize: 12, marginLeft: 8 }}>
          No moon-shot parlays built tonight — lotto pool may be thin or lines moved.
        </span>
      </div>
    )
  }

  const american = slip.combinedAmericanOdds >= 0
    ? `+${slip.combinedAmericanOdds}`
    : `${slip.combinedAmericanOdds}`

  return (
    <div className="ws-chaos-block" style={{ marginBottom: 14 }}>
      <div className="ws-chaos-topbar">
        <span className="ws-chaos-label">🌙 CHAOS BUILDER</span>
        <span className="ws-chaos-odds">{american}</span>
        <span className="ws-pos" style={{ fontFamily: "var(--ws-mono)", fontSize: 12 }}>
          EV {fmtPct(slip.ev)}
        </span>
        <span className="ws-dim" style={{ fontSize: 12 }}>
          {slip.legCount}-leg · prob {fmtPct(slip.combinedModelProb)}
        </span>
      </div>

      {slip.reasoning && (
        <div className="ws-chaos-reasoning">{slip.reasoning}</div>
      )}

      <div className="ws-chaos-legs">
        {slip.legs.map((l) => (
          <div key={l.id} className="ws-chaos-leg">
            <span className="ws-feat-name" style={{ fontSize: 12 }}>{l.player}</span>
            {l.team && <span className="ws-dim" style={{ fontSize: 11 }}> {teamAbbrev(l.team)}</span>}
            <span className="ws-dim" style={{ fontSize: 11 }}>
              {" · "}{compactStat(l.statFamily)} {l.side}{l.line != null ? ` ${l.line}` : ""}
            </span>
            <span style={{ fontFamily: "var(--ws-mono)", fontSize: 12, marginLeft: "auto" }}>
              {fmtOdds(l.odds)}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <button
          className="ws-btn ws-btn-primary"
          style={{ fontSize: 12 }}
          onClick={() => builder.loadAllSlipLegs(slip.legs)}
        >
          🎲 Build this chaos parlay
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* BestBooksCard                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */
function BestBooksCard({ books }: {
  books: { book: string; plays: number; avgScore: number; topPlay?: FeaturedPlay | null }[]
}) {
  return (
    <div className="ws-feat-card" style={{ marginBottom: 14 }}>
      <div className="ws-feat-head">
        <span className="ws-feat-icon">🏦</span>
        <span className="ws-feat-title">Best Books Tonight</span>
        <span className="ws-feat-count">{books.length} ranked</span>
      </div>
      {!books.length && (
        <div className="ws-feat-empty">No book ranking — line shopping data still warming up.</div>
      )}
      {books.slice(0, 5).map((b, i) => (
        <div key={b.book} className="ws-feat-row" style={{ gridTemplateColumns: "16px 1fr auto auto" }}>
          <span className="ws-feat-rank">{i + 1}.</span>
          <span>
            <span className="ws-feat-name">{b.book}</span>
            {b.topPlay ? (
              <div className="ws-feat-prop">
                top: {b.topPlay.player} · {compactStat(b.topPlay.statFamily)} {b.topPlay.side}
                {b.topPlay.line != null ? ` ${b.topPlay.line}` : ""} {fmtOdds(b.topPlay.odds)}
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

/* ─────────────────────────────────────────────────────────────────────────── */
/* KpiCard                                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ws-kpi">
      <div className="ws-kpi-label">{label}</div>
      <div className="ws-kpi-value">{value}</div>
      {sub ? <div className="ws-kpi-sub">{sub}</div> : null}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* MLB Spotlight Grid — 8 MLB-native buckets                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function MlbSpotlightGrid({
  featured,
  tonightsBest,
}: {
  featured: Featured | null | undefined
  tonightsBest: FeaturedPlay[]
}) {
  return (
    <div className="ws-spotlight-grid" style={{ marginBottom: 14 }}>
      <SpotlightCard
        icon="⚾"
        title="HR Bombs"
        tagline="Pitchers bleeding, hitters locked in"
        plays={featured?.bestHr || []}
        emptyMessage="No HR plays cleared trust filters tonight — heavy pitching slate or thin lines."
        accentColor="var(--ws-vol-aggressive)"
      />
      <SpotlightCard
        icon="⚡"
        title="Sharp Steam"
        tagline="Sharp money moved — books are already adjusting"
        plays={featured?.smartAggression || []}
        emptyMessage="No steam plays tonight — books priced sharp. Check back closer to first pitch."
        accentColor="var(--ws-warn)"
      />
      <SpotlightCard
        icon="😴"
        title="Books Sleeping"
        tagline="Model found the gap before the line moved"
        plays={featured?.bestClv || []}
        emptyMessage="Books are priced sharp tonight — no obvious soft lines detected."
        accentColor="var(--ws-accent)"
      />
      <SpotlightCard
        icon="🛡️"
        title="High Confidence"
        tagline="Every filter agreed — edge, model, timing, market"
        plays={featured?.safest || []}
        emptyMessage="Slate is high-variance tonight — no plays cleared all four filters."
        accentColor="var(--ws-positive)"
      />
      <SpotlightCard
        icon="📈"
        title="Sneaky Ladders"
        tagline="Line set too conservative — cumulative stat upside"
        plays={featured?.bestLadders || []}
        emptyMessage="No ladder plays tonight — books have these priced tight."
        accentColor="var(--ws-vol-balanced)"
      />
      <SpotlightCard
        icon="🤝"
        title="Sharp Consensus"
        tagline="Multiple sharp books pointing the same way"
        plays={featured?.marketAgreement || []}
        emptyMessage="Markets are split tonight — no strong multi-book consensus yet."
        accentColor="var(--ws-accent-2)"
      />
      <SpotlightCard
        icon="⏱️"
        title="Act Now"
        tagline="Windows closing — act before the line moves"
        plays={featured?.timingWindows || []}
        emptyMessage="No urgent timing windows right now — lines still settling."
        accentColor="var(--ws-urgency-immediate)"
      />
      <SpotlightCard
        icon="💎"
        title="Tonight's Best"
        tagline="Highest composite scores across all buckets"
        plays={tonightsBest}
        emptyMessage="Still building the nightly board — check back once the full slate loads."
        accentColor="var(--ws-tier-elite)"
      />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* NBA Spotlight Grid — 8 NBA-native buckets                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function NbaSpotlightGrid({
  featured,
  tonightsBest,
}: {
  featured: Featured | null | undefined
  tonightsBest: FeaturedPlay[]
}) {
  return (
    <div className="ws-spotlight-grid" style={{ marginBottom: 14 }}>
      <SpotlightCard
        icon="☢️"
        title="PRA Nukes"
        tagline="Points+Rebounds+Assists combo — game-script gold"
        plays={featured?.bestPra || []}
        emptyMessage="No PRA plays surfaced tonight — combo stat tracking warming up. Check Ladder City for alt-line upside."
        accentColor="var(--ws-vol-aggressive)"
      />
      <SpotlightCard
        icon="🏀"
        title="First Basket Bombs"
        tagline="Opening possession alpha — biggest payout per bet"
        plays={featured?.bestFirstBasket || []}
        emptyMessage="No first basket plays in the scoring pool tonight. Visit the First Basket tab for the full board."
        accentColor="var(--ws-warn)"
      />
      <SpotlightCard
        icon="📈"
        title="Ladder City"
        tagline="Alt lines priced too low — step up, stack value"
        plays={featured?.bestLadders || []}
        emptyMessage="No ladder plays cleared the edge threshold tonight — books have these priced efficiently."
        accentColor="var(--ws-vol-balanced)"
      />
      <SpotlightCard
        icon="⚡"
        title="Pace Attack"
        tagline="High-tempo environment — stat ceilings unlocked"
        plays={featured?.smartAggression || []}
        emptyMessage="No pace-attack plays tonight — slower game-total projections or sharp adjustment already in."
        accentColor="var(--ws-accent)"
      />
      <SpotlightCard
        icon="😴"
        title="Books Sleeping"
        tagline="Model has the edge before the market caught up"
        plays={featured?.bestClv || []}
        emptyMessage="Books are priced sharp tonight — no obvious soft NBA lines detected."
        accentColor="var(--ws-accent-2)"
      />
      <SpotlightCard
        icon="🛡️"
        title="High Confidence"
        tagline="Every filter agreed — edge, model, timing, market"
        plays={featured?.safest || []}
        emptyMessage="High-variance slate tonight — no plays cleared all four filters simultaneously."
        accentColor="var(--ws-positive)"
      />
      <SpotlightCard
        icon="⏱️"
        title="Act Now"
        tagline="Line moving — grab this before the window closes"
        plays={featured?.timingWindows || []}
        emptyMessage="No urgent timing windows right now — lines still settling pre-game."
        accentColor="var(--ws-urgency-immediate)"
      />
      <SpotlightCard
        icon="💎"
        title="Tonight's Best"
        tagline="Highest composite scores across all NBA buckets"
        plays={tonightsBest}
        emptyMessage="Still building the nightly board — check back once the full slate loads."
        accentColor="var(--ws-tier-elite)"
      />
    </div>
  )
}
