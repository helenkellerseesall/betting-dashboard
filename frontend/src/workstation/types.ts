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
}

export interface FeaturedBook {
  book: string
  plays: number
  avgScore: number
  topPlay?: FeaturedPlay | null
}

export interface Featured {
  sport: Sport
  date: string
  summary: string
  anchors: FeaturedPlay[]
  tonightsBest: FeaturedPlay[]
  bestHr: FeaturedPlay[]
  bestLadders: FeaturedPlay[]
  smartAggression: FeaturedPlay[]
  safest: FeaturedPlay[]
  bestClv: FeaturedPlay[]
  marketAgreement: FeaturedPlay[]
  timingWindows: FeaturedPlay[]
  bestBooks: FeaturedBook[]
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
