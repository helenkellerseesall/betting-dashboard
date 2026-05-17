// Shared types for the Betting Workstation. Mirrors backend payload shapes.

export type Sport = "mlb" | "nba"

export interface Candidate {
  id?: string
  player?: string
  team?: string
  eventId?: string
  matchup?: string
  propType?: string
  statFamily?: string
  side?: string
  line?: number
  odds?: number
  oddsAmerican?: number
  modelProb?: number
  edge?: number
  edgeProbability?: number
  predictedProbability?: number
  confidence?: number
  tier?: string
  confidenceTier?: string
  bucket?: string
  book?: string
  sportsbook?: string
  closingOdds?: number | null
  clv?: number | null
  archetype?: string
  marketKey?: string
  // Phase BNDS-1A — canonical context fields preserved by backend BC-1 / OE-1
  // field lifts in normalizeCandidate. All optional; FE renders only when
  // present (anti-fabrication: never invents env data). Used by
  // gameEcosystem.ts to derive per-game discovery surfaces.
  lineupSpot?:           number | null
  depth?:                string | null   // "top" | "middle" | "back" (canonical MLB)
  plateAppearancesProxy?:number | null
  impliedTeamTotal?:     number | null
  gameTotal?:            number | null
  hrEnvironmentTag?:     string | null   // "HR_FRIENDLY" | "HR_NEUTRAL" | "HR_SUPPRESSING"
  contextualTags?:       string[]
  runEnvironment?:       number | null   // 0-1 scalar
  rbiEnvironment?:       number | null
  windDirectionTag?:     string | null   // "out_to_cf" | "in_from_cf" | etc.
  carryShift?:           number | null
  hrFactor?:             number | null
  temperatureF?:         number | null
  bullpenShift?:         number | null
  reliefFatigueScore?:   number | null
  bullpenDataAvailable?: boolean
  // Per-event game-time string when backend supplies it. Best-effort field;
  // FE never invents a kickoff time.
  startTime?:            string | null
  gameTime?:             string | null
  // Cross-book disagreement signals (set by EXPL-1 path when shopMap present)
  consensusConfidence?:  number
  marketDispersion?:     number
}

export interface AiSlipLeg {
  id: string
  player: string
  team?: string
  eventId?: string
  matchup?: string
  statFamily: string
  propType?: string
  side: string
  line?: number
  odds: number
  book?: string
  modelProb?: number
  edge?: number
  volatility?: string
}

export interface AiSlip {
  id: string
  tier: "SAFE" | "BALANCED" | "AGGRESSIVE" | "LOTTO"
  legCount: number
  legs: AiSlipLeg[]
  combinedDecimalOdds: number
  combinedAmericanOdds: number
  combinedModelProb: number
  combinedImpliedProb: number
  edge: number
  ev: number
  volatility: string
  compositeScore: number
  reasoning: string
  narrative?: string[]
  factors?: Record<string, number | null>
  legReasonings?: { legId: string; player: string; reason: string }[]
  // Phase BNSB-1A: reinforcement transparency. OE-11 final reinforced
  // modelProb is `combinedModelProb`; `calibratedCombinedModelProb` is the
  // pre-reinforcement (post-FAMILY_CALIBRATION) probability; `rawCombinedModelProb`
  // is the pre-calibration multiplicative product; `oe11ReinforcementBoost`
  // is the aggregate joint-prob boost factor (∈ [0, 0.03], capped). All four
  // optional — back-compat preserved when backend omits.
  rawCombinedModelProb?: number
  calibratedCombinedModelProb?: number
  oe11ReinforcementBoost?: number
  // Phase BNSB-1A: optional bettor-language phrases for SlipCard surfacing.
  // Populated by future slip-level VBI integration; today FE renders when present.
  bettorLanguageSummary?: string[]
}

export interface AiSlips {
  safe: AiSlip[]
  balanced: AiSlip[]
  aggressive: AiSlip[]
  lotto: AiSlip[]
}

export interface LineShopGroup {
  propGroupKey: string
  player?: string
  team?: string
  statFamily?: string
  side?: string
  line?: number
  bookCount: number
  bestBook?: string
  bestOdds?: number
  worstBook?: string
  worstOdds?: number
  consensusOdds?: number
  oddsSpread?: number | null
  impliedSpread?: number | null
  flags?: string[]
  // Phase Market-Ecology-1A / Operator-Experience-1A — additive market context.
  consensusConfidence?: number  // 1.0 = unanimous, 0.0 = wide disagreement
  marketDispersion?: number     // std dev of implied probs across books
  bestImpDelta?: number         // best book's implied prob - consensus (negative = bettor value)
}

export interface TimingClassification {
  key: string
  player?: string
  statFamily?: string
  side?: string
  line?: number
  state: string
  urgency: string
  eventId?: string
  bookCount?: number
  hoursToGame?: number
}

export interface PortfolioCorrelationCluster {
  type: string
  key: string
  label: string
  count: number
  level: "low" | "moderate" | "high"
  note: string
  scriptRisk?: boolean
}

export interface PortfolioConflict {
  type: string
  player?: string
  note: string
}

export interface PortfolioWarning {
  level: "high" | "moderate" | "low"
  type: string
  label: string
  count?: number
}

export interface Portfolio {
  score: number
  grade: string
  mood?: { tone: "good" | "neutral" | "watch"; headline: string }
  warnings: (PortfolioWarning | string)[]
  correlations?: { clusters: PortfolioCorrelationCluster[]; highCount: number; modCount: number; overallCorrelation: string }
  conflicts: PortfolioConflict[]
  exposureMap?: any
  nudges?: Record<string, number>
}

export interface FeaturedPlay {
  id: string
  player: string
  team?: string
  eventId?: string
  matchup?: string
  statFamily: string
  propType?: string
  side: string
  line?: number
  odds: number
  book?: string
  bestBook?: string
  bestOdds?: number
  bookCount?: number
  modelProb?: number
  edge?: number
  volatility?: string
  tier?: string
  timingState?: string
  timingUrgency?: string
  reasoning?: string
  processNote?: string | null
  attackNote?: string
  composite: number
  factors?: Record<string, number>
  // Phase Operator-Experience-1A — additive market & disagreement context.
  consensusConfidence?: number  // 1.0 = unanimous, 0.0 = wide disagreement
  marketDispersion?: number
  bestImpDelta?: number         // best book vs consensus (negative = bettor value)
  // Phase Operator-Experience-1A — set when bucket originates from staleRows.
  staleRowTag?: "soft_line" | "stale_line"
  staleRowDelta?: number
  consensus?: number
  avoidReason?: string          // surfaced on inflatedSuperstarSpots entries
}

export interface FeaturedBook {
  book: string
  plays: number
  avgScore: number
  topPlay?: FeaturedPlay | null
}

// Phase Recommendation-Hierarchy-1A (HIER-2) — deterministic decision ladder.
// 7 fixed-cardinality named role-slots derived purely from canonical buckets.
// Every slot is FeaturedPlay | null. Empty slot doctrine: when source bucket
// is empty OR every entry was claimed by an earlier-priority slot, value is
// null — the frontend renders an honest "(no qualifying X tonight)" and
// NEVER fabricates a fallback pick. See backend buildRecommendationLadder
// for slot priority + dedup doctrine.
export interface RecommendationLadder {
  bestOverall:           FeaturedPlay | null
  safestPlay:            FeaturedPlay | null
  bestUpsidePlay:        FeaturedPlay | null
  bestBalancedPlay:      FeaturedPlay | null
  bestDisagreement:      FeaturedPlay | null
  mostOverpricedAvoid:   FeaturedPlay | null
  highestTrapRiskAvoid:  FeaturedPlay | null
  // Phase Bettor-Curation-Intelligence-1A (BC-6): slot 8 — believable upside.
  bestBelievableUpside?: FeaturedPlay | null
  // Phase Offensive-Ecology-Intelligence-1A (OE-7): slot 9 — explosive upside.
  bestExplosiveUpside?:  FeaturedPlay | null
}

// Phase BNSB-1A — backend stats payloads (BC-1A / OE-1A / OE-1B / MLB-COV-1A).
// Per-run advisory counters returned on buildFeaturedPlays / buildAiSlips results.
export interface Bc1aStats {
  suppressedHrSuppressing?: number
  suppressedDesertTeamTotal?: number
}
export interface Oe1aStats {
  explosiveEventsTagged?: number
  hrCarryBoostsApplied?: number
  runProductionBoostsApplied?: number
  pressureBoostsApplied?: number
  survivabilityDemotesApplied?: number
}
export interface Oe1bStats {
  pairReinforcementBoosts?: number
  turnoverBoostsApplied?: number
  bullpenBoostsApplied?: number
  lineupTurnoverEventsHigh?: number
}
export interface Oe11SlipStats {
  reinforcedSlips?: number
  totalReinforcementBoosts?: number
}
export interface MlbCovStats {
  blockedSharedGameSuppression?: number
  blockedPitcherHitterConflict?: number
}
// Phase BNSB-1A — BC-8 bettorRealismScore advisory aggregate.
export interface BettorRealismScore {
  score: number
  depthCoverage: number
  avgTeamTotal: number | null
  avgTeamTotalNorm: number
  avgGameTotal: number | null
  gameTotalFavorability: number
  hrEnvFavorability: number
  sampleSize: number
  depthSeen: number
  ttCount: number
  gtCount: number
  envSeen: number
}

export interface Featured {
  sport: Sport
  date: string
  summary: string
  anchors: FeaturedPlay[]
  tonightsBest: FeaturedPlay[]
  bestHr: FeaturedPlay[]
  bestPra: FeaturedPlay[]
  bestFirstBasket: FeaturedPlay[]
  bestLadders: FeaturedPlay[]
  smartAggression: FeaturedPlay[]
  safest: FeaturedPlay[]
  bestClv: FeaturedPlay[]
  marketAgreement: FeaturedPlay[]
  timingWindows: FeaturedPlay[]
  bestBooks: FeaturedBook[]
  // Phase Operator-Experience-1A — 8 new actionable operator buckets.
  bestBalanced?: FeaturedPlay[]
  bestAggressive?: FeaturedPlay[]
  bestUnders?: FeaturedPlay[]
  bestAltLadders?: FeaturedPlay[]
  bestDisagreementEdges?: FeaturedPlay[]
  staleLineOpportunities?: FeaturedPlay[]
  trapLadders?: FeaturedPlay[]
  inflatedSuperstarSpots?: FeaturedPlay[]
  // Phase BC-1A / OE-1A — additional bettor-curation / offensive-ecology buckets.
  believableUpsideTickets?: FeaturedPlay[]
  explosiveUpsideTickets?: FeaturedPlay[]
  // Phase Recommendation-Hierarchy-1A — fixed-cardinality decision ladder.
  recommendationLadder?: RecommendationLadder
  // Phase BNSB-1A — backend stats payloads (BC-1A / OE-1A / OE-1B).
  bc1aStats?: Bc1aStats
  oe1aStats?: Oe1aStats
  oe1bStats?: Oe1bStats
}

export interface SportState {
  sport: Sport
  date: string
  counts: {
    candidates: number
    urgent: number
    propsWithMultiBook: number
    steam: number
    stale: number
  }
  bankrollInfo?: { bankroll?: number; dailyRiskBudget?: number } | null
  candidates: Candidate[]
  // Phase BNDS-1B — DISCOVERY-SAFE EXPANSION.
  //
  // Broader canonical pool surfaced for the FE Discover tab only.
  // Same source as `candidates` (canonical validated supplemented pool) but
  // with looser per-player / per-game / per-stat / per-stat-side caps so the
  // battlefield breadth is visible. Elite consumers (Tonight's Edge / AI
  // Parlays / Portfolio) still read `candidates` — their tight diversification
  // is preserved verbatim.
  //
  // Optional: legacy backend versions that haven't shipped BNDS-1B yet omit
  // this field; FE Discover gracefully falls back to `candidates`.
  discoveryCandidates?: Candidate[]
  slipBets: any[]
  lineShopping: { groups: LineShopGroup[]; meta: any } | null
  timing: { classifications: TimingClassification[]; meta: any } | null
  portfolio: Portfolio | null
  aiSlips: AiSlips
  // Phase BNSB-1A — extend aiSlipsSummary with advisory metrics already
  // computed by buildAiSlips (BC-8 bettorRealismScore, OE-11 slip stats,
  // MLB-COV-1A stats). All optional — back-compat preserved.
  aiSlipsSummary: {
    summary?: string
    warnings?: string[]
    bettorRealismScore?: BettorRealismScore | null
    oe11SlipStats?: Oe11SlipStats
    mlbCovStats?: MlbCovStats
  }
  featured?: Featured | null
}

// ── Phase BNSB-1A (FE-VBI-3) — canonical VBI verdict shape ──────────────────
//
// Mirrors backend `resolveSlipLegToPrediction.VERDICT_PAYLOAD_SHAPE` exactly.
// Used by AnalyzeSlipView + VerdictCard to render screenshot/upload analysis.

export type VbiSignalScope = "leg" | "pair" | "slip"
export interface VbiSignal {
  id: string
  scope: VbiSignalScope
  payload?: Record<string, unknown>
}
export interface VbiLegRef {
  legIndex: number
  reason?: string
  [k: string]: unknown
}
export interface VbiVerdict {
  verdictSummary: string
  strongestLeg: VbiLegRef | null
  weakestLeg:   VbiLegRef | null
  contradictionFlags: Array<{ legA: number; legB: number; reason: string }>
  ecologicalCoherence: number
  covarianceProfile: {
    positiveStacks: Array<{ legA: number; legB: number; score: number }>
    pitcherHitterConflicts: Array<{ legA: number; legB: number }>
    sharedGameSuppression:  Array<{ legA: number; legB: number }>
  }
  exploitabilityProfile: {
    marketSupported: VbiLegRef[]
    unsupportedSoloEdge: VbiLegRef[]
  }
  availabilityProfile: { hardDropOut: VbiLegRef[] }
  fakeSafeRisk: { detected: boolean; reasons: string[] }
  unresolvedLegs: Array<{ legIndex: number; unresolvedReason: string }>
  signals: VbiSignal[]
  bettorLanguageSummary: string[]
}
// FE-VBI-1 response shape from POST /api/ws/screenshots/ingest
export interface ScreenshotIngestResult {
  index: number
  ok: boolean
  slipId?: string
  legs?: number
  legsParsed?: Array<Record<string, unknown>>
  sport?: string
  archetype?: string
  compositeScore?: number
  sharpSignal?: boolean
  baitSignal?: boolean
  verdict?: VbiVerdict | null
  error?: string
}
export interface ScreenshotIngestResponse {
  ok: boolean
  submissionId?: string
  slipsIngested?: number
  results?: ScreenshotIngestResult[]
  error?: string
}

export interface BuilderLeg {
  id: string
  player: string
  team?: string
  eventId?: string
  matchup?: string
  statFamily: string
  side: string
  line?: number
  odds: number
  modelProb?: number
  sportsbook?: string
  book?: string
}

export interface BuilderPreview {
  legs: number
  combinedDecimal?: number
  combinedAmerican?: number | null
  modelProb?: number
  impliedProb?: number
  edge?: number
  ev?: number
  payout?: number
  stake?: number
  portfolioScore?: number
  portfolioGrade?: string
  warnings?: string[]
  conflicts?: PortfolioConflict[]
  correlations?: PortfolioCorrelationCluster[]
  summary?: string
}
