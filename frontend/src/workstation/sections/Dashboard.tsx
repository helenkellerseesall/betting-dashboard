import type {
  SportState,
  FeaturedPlay,
  AiSlip,
  Featured,
  BettorRealismScore,
  Bc1aStats,
  Oe1aStats,
  Oe1bStats,
  Oe11SlipStats,
  MlbCovStats,
} from "../types"
import { HeroPickCard } from "../components/HeroPickCard"
import { SpotlightCard } from "../components/SpotlightCard"
// Phase Recommendation-Hierarchy-1A (HIER-4): deterministic decision ladder
// component renders BETWEEN risk pulse and HeroPickCard so the operator sees
// the fixed-cardinality role-named recommendations BEFORE the emotional hero.
import { RecommendationLadder } from "../components/RecommendationLadder"
import { fmtOdds, fmtPct, compactStat, teamAbbrev } from "../utils"
import { useBuilder } from "../builderContext"
// Phase Operator-Experience-1B-1: deterministic plain-English tooltip helpers.
import {
  tooltipForAnchorCount,
  tooltipForAiParlayMix,
  tooltipForSteamCount,
  tooltipForStaleWindowCount,
  tooltipForBookCoverageCount,
} from "../tooltips"

/**
 * Dashboard — the bettor's command center.
 *
 * Visual hierarchy (post Phase Recommendation-Hierarchy-1A):
 *   1. Snapshot strip — quick numbers
 *   2. Risk pulse — single-line portfolio mood
 *   3. RecommendationLadder — 7 deterministic decision slots (NEW Phase Hier-1A)
 *   4. HeroPickCard — ☢️ nuclear play, emotional emphasis on bestOverall
 *   5. Supporting picks — remaining anchors + tonight's best
 *   6. ActionableBucketsGrid + sport-native spotlight grid
 *   7. Chaos Builder — best moon-shot parlay
 *   8. Best Books — book rankings
 *
 * The ladder is the decision-grade scan-line; the hero card retains
 * emotional emphasis on the single highest-composite anchor.
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
          tooltip={tooltipForAnchorCount(anchors.length)}
        />
        <KpiCard
          label="AI Parlays"
          value={`${aiCount}`}
          sub={`core:${aiSlips.safe.length} mix:${aiSlips.balanced.length} fire:${aiSlips.aggressive.length} moon:${aiSlips.lotto.length}`}
          tooltip={tooltipForAiParlayMix(aiSlips.safe.length, aiSlips.balanced.length, aiSlips.aggressive.length, aiSlips.lotto.length)}
        />
        <KpiCard
          label="Live Calls"
          value={`${counts.urgent}`}
          sub={`${counts.steam} steam · ${counts.stale} stale windows`}
          tooltip={`${tooltipForSteamCount(counts.steam)} ${tooltipForStaleWindowCount(counts.stale)}`}
        />
        <KpiCard
          label="Book Coverage"
          value={`${counts.propsWithMultiBook}`}
          sub="props across 2+ books"
          tooltip={tooltipForBookCoverageCount(counts.propsWithMultiBook)}
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

      {/* ── 2b. Phase BNSB-1A (BNSB-2 + BNSB-4): Intelligence + Realism strip ──
          Surfaces backend stats already returned on payloads:
            BC-8  bettorRealismScore                  (slip-pool composition advisory)
            BC-1A bc1aStats                           (realism gate counter)
            OE-1A oe1aStats                           (offensive ecology counter)
            OE-1B oe1bStats                           (offensive reinforcement counter)
            OE-11 oe11SlipStats                       (per-slip reinforcement counter)
            MLB-COV-1A mlbCovStats                    (covariance suppression counter)
          Pure observational. No fabrication; absent values render dimmed. */}
      <IntelligenceStrip
        bettorRealismScore={state.aiSlipsSummary?.bettorRealismScore ?? null}
        bc1aStats={featured?.bc1aStats}
        oe1aStats={featured?.oe1aStats}
        oe1bStats={featured?.oe1bStats}
        oe11SlipStats={state.aiSlipsSummary?.oe11SlipStats}
        mlbCovStats={state.aiSlipsSummary?.mlbCovStats}
      />

      {/* ── 3. RecommendationLadder — Phase Recommendation-Hierarchy-1A (HIER-4) ─
          Deterministic 7-slot decision hierarchy. Rendered BEFORE HeroPickCard
          so the operator sees fixed-cardinality role-named picks (Best Overall /
          Safest / Best Disagreement / Best Balanced / Best Upside / Most
          Overpriced / Highest Trap Risk) in a single glance. Empty slots show
          honest "(no qualifying X tonight)" — never fabricated. */}
      <RecommendationLadder ladder={featured?.recommendationLadder} />

      {/* ── 4. Nuclear Pick hero ─────────────────────────────────────────── */}
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

      {/* ── 5a. Phase Operator-Experience-1A: ACTIONABLE OPERATOR BUCKETS ── */}
      {/* 8 new buckets derived deterministically from existing data. */}
      <ActionableBucketsGrid featured={featured} />

      {/* ── 5b. Spotlight grid — sport-aware ─────────────────────────────── */}
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
/* Phase Operator-Experience-1B-1: optional deterministic tooltip — applies to  */
/* the whole card surface so the operator can hover anywhere to read context.   */
/* ─────────────────────────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, tooltip }: { label: string; value: string; sub?: string; tooltip?: string }) {
  return (
    <div className="ws-kpi" title={tooltip || undefined}>
      <div className="ws-kpi-label">{label}</div>
      <div className="ws-kpi-value">{value}</div>
      {sub ? <div className="ws-kpi-sub">{sub}</div> : null}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Phase Operator-Experience-1A: ActionableBucketsGrid                          */
/* 8 new operator-priority buckets: bestBalanced / bestAggressive / bestUnders  */
/* / bestAltLadders / bestDisagreementEdges / staleLineOpportunities /          */
/* trapLadders / inflatedSuperstarSpots. Each bucket sources from existing      */
/* deterministic backend data — no fabrication. Empty bucket → empty card.      */
/* Rendered ABOVE the existing 8 sport-native spotlight buckets so the operator */
/* sees the calibration-/market-informed actionable view first.                 */
/* ─────────────────────────────────────────────────────────────────────────── */
function ActionableBucketsGrid({ featured }: { featured: Featured | null | undefined }) {
  const bestBalanced           = featured?.bestBalanced           || []
  const bestAggressive         = featured?.bestAggressive         || []
  const bestUnders             = featured?.bestUnders             || []
  const bestAltLadders         = featured?.bestAltLadders         || []
  const bestDisagreementEdges  = featured?.bestDisagreementEdges  || []
  const staleLineOpportunities = featured?.staleLineOpportunities || []
  const trapLadders            = featured?.trapLadders            || []
  const inflatedSuperstarSpots = featured?.inflatedSuperstarSpots || []

  // Skip the whole section if every bucket is empty (clutter-reduction discipline).
  const anyPopulated =
    bestBalanced.length || bestAggressive.length || bestUnders.length ||
    bestAltLadders.length || bestDisagreementEdges.length ||
    staleLineOpportunities.length || trapLadders.length ||
    inflatedSuperstarSpots.length
  if (!anyPopulated) return null

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="ws-supporting-label" style={{ marginBottom: 6 }}>Actionable Operator Buckets</div>
      <div className="ws-spotlight-grid">
        <SpotlightCard
          icon="🔥"
          title="Best Balanced"
          tagline="Multi-book + healthy edge + balanced volatility"
          plays={bestBalanced}
          emptyMessage="No qualifying balanced picks tonight — wait for more multi-book coverage."
          accentColor="var(--ws-vol-balanced)"
        />
        <SpotlightCard
          icon="🔥"
          title="Best Aggressive"
          tagline="Aggressive volatility + real edge (post Realism-1A AGG-2 + TEXT-1)"
          plays={bestAggressive}
          emptyMessage="No aggressive picks cleared edge filters tonight."
          accentColor="var(--ws-vol-aggressive)"
        />
        <SpotlightCard
          icon="🔥"
          title="Best Unders"
          tagline="Under-side picks — historical hit rate favors unders"
          plays={bestUnders}
          emptyMessage="No under-side picks cleared edge filters tonight."
          accentColor="var(--ws-accent-2)"
        />
        <SpotlightCard
          icon="🔥"
          title="Best Alt Ladders"
          tagline="Alt-line ladders with cross-book consensus"
          plays={bestAltLadders}
          emptyMessage="No alt-line ladders cleared confidence filters tonight."
          accentColor="var(--ws-tier-elite)"
        />
        <SpotlightCard
          icon="🔥"
          title="Best Disagreement Edges"
          tagline="Books that underprice your side vs consensus (sorted by sharpness)"
          plays={bestDisagreementEdges}
          emptyMessage="No book-disagreement edges surfaced — markets aligned tonight."
          accentColor="var(--ws-positive)"
        />
        <SpotlightCard
          icon="🔥"
          title="Stale-Line Opportunities"
          tagline="Soft books with highest cash payout per disagreement"
          plays={staleLineOpportunities}
          emptyMessage="No stale-line cash opportunities — books priced sharp."
          accentColor="var(--ws-positive)"
        />
        <SpotlightCard
          icon="⚠"
          title="Trap Ladders"
          tagline="High-payout alt lines with thin book coverage — AVOID"
          plays={trapLadders}
          emptyMessage="No trap ladders flagged tonight."
          accentColor="var(--ws-warn)"
        />
        <SpotlightCard
          icon="⚠"
          title="Inflated Spots"
          tagline="Books overpricing vs consensus — AVOID"
          plays={inflatedSuperstarSpots}
          emptyMessage="No inflated-spot flags tonight."
          accentColor="var(--ws-warn)"
        />
      </div>
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
/* Phase BNSB-1A (BNSB-2 + BNSB-4): IntelligenceStrip                          */
/* Surfaces backend intelligence already returned on payloads but previously   */
/* invisible to the operator. Two parts:                                       */
/*   (a) BC-8 bettorRealismScore  → compact advisory badge                     */
/*   (b) OE-1A / OE-1B / BC-1A / OE-11 / MLB-COV-1A counters → mini chip row   */
/*                                                                             */
/* Anti-fabrication doctrine: every value is rendered exactly as the backend   */
/* returned it. Absent fields render as a dimmed "—" or the section is hidden  */
/* outright. We never synthesize a score, never combine, never interpret.      */
/* ─────────────────────────────────────────────────────────────────────────── */
function IntelligenceStrip({
  bettorRealismScore,
  bc1aStats,
  oe1aStats,
  oe1bStats,
  oe11SlipStats,
  mlbCovStats,
}: {
  bettorRealismScore: BettorRealismScore | null | undefined
  bc1aStats?:        Bc1aStats
  oe1aStats?:        Oe1aStats
  oe1bStats?:        Oe1bStats
  oe11SlipStats?:    Oe11SlipStats
  mlbCovStats?:      MlbCovStats
}) {
  // Realism badge presence: BC-8 returns a score iff bettorRealismScore is non-null
  const hasRealism = !!bettorRealismScore && Number.isFinite(bettorRealismScore.score)

  // Counter strip chips: each is rendered only when its source counter is > 0.
  // We deliberately suppress 0-valued counters so the strip stays terse and
  // honest — a chip's presence is itself the signal.
  type Chip = { icon: string; label: string; value: number; tooltip: string }
  const chips: Chip[] = []

  // OE-1A — offensive ecology tagging + boosts (Featured-level)
  if (oe1aStats?.explosiveEventsTagged)
    chips.push({ icon: "💥", label: "explosive events tagged", value: oe1aStats.explosiveEventsTagged,
      tooltip: "OE-1A: candidates tagged as explosive (HR / blowup / pressure environments)." })
  if (oe1aStats?.hrCarryBoostsApplied)
    chips.push({ icon: "🔋", label: "HR carry boosts", value: oe1aStats.hrCarryBoostsApplied,
      tooltip: "OE-1A: small-cap boosts applied to props carried by HR-rich slates." })
  if (oe1aStats?.runProductionBoostsApplied)
    chips.push({ icon: "🏃", label: "run-production boosts", value: oe1aStats.runProductionBoostsApplied,
      tooltip: "OE-1A: boosts applied where team-total run production was meaningfully favorable." })
  if (oe1aStats?.pressureBoostsApplied)
    chips.push({ icon: "🎯", label: "pressure boosts", value: oe1aStats.pressureBoostsApplied,
      tooltip: "OE-1A: boosts applied where game-script pressure was meaningfully favorable." })
  if (oe1aStats?.survivabilityDemotesApplied)
    chips.push({ icon: "⬇", label: "survivability demotes", value: oe1aStats.survivabilityDemotesApplied,
      tooltip: "OE-1A: soft demotes applied where the play required survival on a thin or hostile environment." })

  // OE-1B — reinforcement & turnover (Featured-level)
  if (oe1bStats?.pairReinforcementBoosts)
    chips.push({ icon: "🔗", label: "pair reinforcement", value: oe1bStats.pairReinforcementBoosts,
      tooltip: "OE-1B: pairwise reinforcement boosts where two props share a positive ecology." })
  if (oe1bStats?.turnoverBoostsApplied)
    chips.push({ icon: "🔄", label: "lineup-turnover boosts", value: oe1bStats.turnoverBoostsApplied,
      tooltip: "OE-1B: boosts applied where lineup turnover surfaced opportunity." })
  if (oe1bStats?.bullpenBoostsApplied)
    chips.push({ icon: "🫳", label: "bullpen boosts", value: oe1bStats.bullpenBoostsApplied,
      tooltip: "OE-1B: boosts applied where bullpen volatility surfaced opportunity." })
  if (oe1bStats?.lineupTurnoverEventsHigh)
    chips.push({ icon: "📋", label: "high-turnover events", value: oe1bStats.lineupTurnoverEventsHigh,
      tooltip: "OE-1B: events flagged as high lineup turnover (advisory)." })

  // BC-1A — realism gate suppressions
  if (bc1aStats?.suppressedHrSuppressing)
    chips.push({ icon: "🚫", label: "HR-suppressing rejects", value: bc1aStats.suppressedHrSuppressing,
      tooltip: "BC-1A: realism-gate suppressions of props requiring HR-suppressing environments to hit." })
  if (bc1aStats?.suppressedDesertTeamTotal)
    chips.push({ icon: "🏜", label: "desert team-total rejects", value: bc1aStats.suppressedDesertTeamTotal,
      tooltip: "BC-1A: realism-gate suppressions of props sitting on desert (low-run) team totals." })

  // OE-11 — per-slip reinforcement (slip-level)
  if (oe11SlipStats?.reinforcedSlips)
    chips.push({ icon: "🧪", label: "reinforced slips", value: oe11SlipStats.reinforcedSlips,
      tooltip: "OE-11: AI parlay slips where pairwise ecology reinforcement was applied to joint probability." })
  if (oe11SlipStats?.totalReinforcementBoosts)
    chips.push({ icon: "✚", label: "reinforcement boosts", value: oe11SlipStats.totalReinforcementBoosts,
      tooltip: "OE-11: total pairwise reinforcement boost events across all AI slips this run." })

  // MLB-COV-1A — covariance suppressions (slip-level)
  if (mlbCovStats?.blockedSharedGameSuppression)
    chips.push({ icon: "🛑", label: "shared-game blocks", value: mlbCovStats.blockedSharedGameSuppression,
      tooltip: "MLB-COV-1A: pair combinations blocked because they shared a suppressed game environment." })
  if (mlbCovStats?.blockedPitcherHitterConflict)
    chips.push({ icon: "🆚", label: "pitcher-hitter conflicts", value: mlbCovStats.blockedPitcherHitterConflict,
      tooltip: "MLB-COV-1A: pair combinations blocked because a pitcher-K and hitter-OVER conflicted." })

  // If nothing surfaced from either source, render a single dimmed advisory
  // line instead of a giant empty box — honest absence, no fabrication.
  const showStrip = hasRealism || chips.length > 0
  if (!showStrip) {
    return (
      <div style={{ marginBottom: 14, fontSize: 11, color: "var(--ws-dim, #888)", fontStyle: "italic" }}>
        Intelligence strip: no realism advisory and no curated/ecology counters surfaced this run.
      </div>
    )
  }

  // Tone for the realism badge — purely advisory, derived from canonical
  // 0-100 score thresholds. We do NOT redefine the score; we only choose a
  // class name based on it for display contrast.
  let realismTone = "neutral"
  if (hasRealism) {
    const s = bettorRealismScore!.score
    if (s >= 70)      realismTone = "good"
    else if (s >= 40) realismTone = "neutral"
    else              realismTone = "watch"
  }

  return (
    <div className="ws-risk-pulse" style={{ marginBottom: 14, alignItems: "center" }}>
      {/* BC-8 bettorRealismScore badge */}
      {hasRealism && (
        <span
          className={`ws-mood-pill ${realismTone}`}
          title={
            `BC-8 bettorRealismScore (slip-pool realism advisory).\n` +
            `score ${bettorRealismScore!.score}/100\n` +
            `depthCoverage ${bettorRealismScore!.depthCoverage}\n` +
            `avgTeamTotal ${bettorRealismScore!.avgTeamTotal ?? "—"} (norm ${bettorRealismScore!.avgTeamTotalNorm})\n` +
            `avgGameTotal ${bettorRealismScore!.avgGameTotal ?? "—"}\n` +
            `gameTotalFavorability ${bettorRealismScore!.gameTotalFavorability}\n` +
            `hrEnvFavorability ${bettorRealismScore!.hrEnvFavorability}\n` +
            `sampleSize ${bettorRealismScore!.sampleSize}`
          }
        >
          🧠 realism {bettorRealismScore!.score}/100
        </span>
      )}

      {/* Counter strip — one chip per non-zero counter */}
      {chips.length > 0 ? (
        <span className="ws-risk-warnings" style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c, i) => (
            <span
              key={`${c.label}-${i}`}
              className="ws-risk-flag"
              title={c.tooltip}
              style={{ fontSize: 11 }}
            >
              {c.icon} {c.value} {c.label}
            </span>
          ))}
        </span>
      ) : (
        hasRealism && (
          <span className="ws-dim" style={{ fontSize: 11, fontStyle: "italic" }}>
            no curated/ecology counters surfaced this run.
          </span>
        )
      )}
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
