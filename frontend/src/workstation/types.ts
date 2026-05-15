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
  // Phase Recommendation-Hierarchy-1A — fixed-cardinality decision ladder.
  recommendationLadder?: RecommendationLadder
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
  slipBets: any[]
  lineShopping: { groups: LineShopGroup[]; meta: any } | null
  timing: { classifications: TimingClassification[]; meta: any } | null
  portfolio: Portfolio | null
  aiSlips: AiSlips
  aiSlipsSummary: { summary?: string; warnings?: string[] }
  featured?: Featured | null
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
