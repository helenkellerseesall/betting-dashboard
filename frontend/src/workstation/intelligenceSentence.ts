// Phase BNSB-1B (BNSB-1B-7): composeIntelligenceSentence
//
// Pure deterministic helper. Composes a single bettor-readable sentence from
// the canonical per-run counters returned on backend payloads (BC-1A / OE-1A /
// OE-1B / OE-11 / MLB-COV-1A).
//
// Anti-fabrication discipline:
//   • Only mentions counters that are > 0. Zero counters are silently omitted.
//   • Phrasing is fixed-template per counter — no LLM, no synthesis.
//   • When NO counters fire, returns null (caller renders an honest empty
//     state — never a fabricated "nothing happening" sentence).
//   • The sentence is a deterministic function of (canonical counter object) →
//     same input always produces same string.
//
// Output target: one line on the Dashboard IntelligenceStrip that reads like a
// bettor's take ("Tonight: 3 explosive games tagged · 1 same-team stack
// reinforced · 1 fake-safe pair blocked.") rather than a per-counter chip
// dump.
//
// Used by Dashboard.tsx IntelligenceStrip; the underlying counter chips remain
// available as a collapsible drill-down (forensic mode).

import type { Bc1aStats, Oe1aStats, Oe1bStats, Oe11SlipStats, MlbCovStats } from "./types"

export interface IntelligenceSentenceInput {
  bc1aStats?:     Bc1aStats
  oe1aStats?:     Oe1aStats
  oe1bStats?:     Oe1bStats
  oe11SlipStats?: Oe11SlipStats
  mlbCovStats?:   MlbCovStats
}

/**
 * Build one bettor-readable sentence from canonical counters. Returns null
 * when no counter is > 0 (caller decides empty-state copy).
 */
export function composeIntelligenceSentence(input: IntelligenceSentenceInput): string | null {
  const fragments: string[] = []

  // ── OE-1A — offensive ecology env tagging + boosts ──────────────────────────
  const oe1a = input.oe1aStats || {}
  if ((oe1a.explosiveEventsTagged ?? 0) > 0) {
    fragments.push(
      `${oe1a.explosiveEventsTagged} explosive ${pluralize("game", oe1a.explosiveEventsTagged!)} tagged`
    )
  }
  if ((oe1a.hrCarryBoostsApplied ?? 0) > 0) {
    fragments.push(
      `${oe1a.hrCarryBoostsApplied} HR-carry ${pluralize("boost", oe1a.hrCarryBoostsApplied!)} applied`
    )
  }
  if ((oe1a.runProductionBoostsApplied ?? 0) > 0) {
    fragments.push(
      `${oe1a.runProductionBoostsApplied} run-production ${pluralize("boost", oe1a.runProductionBoostsApplied!)} applied`
    )
  }
  if ((oe1a.pressureBoostsApplied ?? 0) > 0) {
    fragments.push(
      `${oe1a.pressureBoostsApplied} pressure ${pluralize("boost", oe1a.pressureBoostsApplied!)} applied`
    )
  }
  if ((oe1a.survivabilityDemotesApplied ?? 0) > 0) {
    fragments.push(
      `${oe1a.survivabilityDemotesApplied} ladder ${pluralize("demote", oe1a.survivabilityDemotesApplied!)} for thin survivability`
    )
  }

  // ── OE-1B — reinforcement & turnover ────────────────────────────────────────
  const oe1b = input.oe1bStats || {}
  if ((oe1b.pairReinforcementBoosts ?? 0) > 0) {
    fragments.push(
      `${oe1b.pairReinforcementBoosts} same-team ${pluralize("stack", oe1b.pairReinforcementBoosts!)} reinforced`
    )
  }
  if ((oe1b.turnoverBoostsApplied ?? 0) > 0) {
    fragments.push(
      `${oe1b.turnoverBoostsApplied} lineup-turnover ${pluralize("boost", oe1b.turnoverBoostsApplied!)} applied`
    )
  }
  if ((oe1b.bullpenBoostsApplied ?? 0) > 0) {
    fragments.push(
      `${oe1b.bullpenBoostsApplied} bullpen-fragility ${pluralize("boost", oe1b.bullpenBoostsApplied!)} applied`
    )
  }
  if ((oe1b.lineupTurnoverEventsHigh ?? 0) > 0) {
    fragments.push(
      `${oe1b.lineupTurnoverEventsHigh} ${pluralize("game", oe1b.lineupTurnoverEventsHigh!)} flagged high-turnover`
    )
  }

  // ── BC-1A — realism gate ────────────────────────────────────────────────────
  const bc1a = input.bc1aStats || {}
  if ((bc1a.suppressedHrSuppressing ?? 0) > 0) {
    fragments.push(
      `${bc1a.suppressedHrSuppressing} HR-suppressing-park ${pluralize("play", bc1a.suppressedHrSuppressing!)} softly demoted`
    )
  }
  if ((bc1a.suppressedDesertTeamTotal ?? 0) > 0) {
    fragments.push(
      `${bc1a.suppressedDesertTeamTotal} desert-team-total ${pluralize("play", bc1a.suppressedDesertTeamTotal!)} softly demoted`
    )
  }

  // ── OE-11 — slip-level reinforcement ────────────────────────────────────────
  const oe11 = input.oe11SlipStats || {}
  if ((oe11.reinforcedSlips ?? 0) > 0) {
    fragments.push(
      `${oe11.reinforcedSlips} parlay ${pluralize("slip", oe11.reinforcedSlips!)} earned pair reinforcement`
    )
  }
  // Note: totalReinforcementBoosts intentionally omitted from the sentence —
  // it's a magnitude scalar (≤ 0.03 aggregate) that adds operator-grade noise
  // without bettor-readable meaning. Available in the forensic chip drill-down.

  // ── MLB-COV-1A — covariance blocks ──────────────────────────────────────────
  const cov = input.mlbCovStats || {}
  if ((cov.blockedSharedGameSuppression ?? 0) > 0) {
    fragments.push(
      `${cov.blockedSharedGameSuppression} fake-safe ${pluralize("pair", cov.blockedSharedGameSuppression!)} blocked`
    )
  }
  if ((cov.blockedPitcherHitterConflict ?? 0) > 0) {
    fragments.push(
      `${cov.blockedPitcherHitterConflict} pitcher-vs-hitter ${pluralize("conflict", cov.blockedPitcherHitterConflict!)} blocked`
    )
  }

  if (fragments.length === 0) return null

  // Join with " · " separators and wrap with the bettor-facing lead-in.
  return `Tonight: ${fragments.join(" · ")}.`
}

function pluralize(noun: string, n: number): string {
  if (n === 1) return noun
  // English-only pluralization (workstation is en-US). Special cases for the
  // nouns this helper uses; defaults to +"s".
  if (noun === "conflict") return "conflicts"
  if (noun === "play")     return "plays"
  if (noun === "game")     return "games"
  if (noun === "boost")    return "boosts"
  if (noun === "demote")   return "demotes"
  if (noun === "stack")    return "stacks"
  if (noun === "slip")     return "slips"
  if (noun === "pair")     return "pairs"
  return noun + "s"
}
