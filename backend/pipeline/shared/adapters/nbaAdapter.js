"use strict"

/**
 * NBA adapter for the universal post-game review engine.
 *
 * Pure functions. NO file IO, NO mutation of inputs. Receive a tracked bet
 * (already merged with `actualStat` + optional `environment`) and return
 * "why" tags / archetype hints / environment tags.
 *
 * No hardcoded players. All logic is structural (stat family, line, side,
 * environment fields supplied by the slate).
 */

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function statFamily(b) {
  return String(b?.statFamily || "").toLowerCase()
}

function side(b) {
  return String(b?.side || "").toLowerCase()
}

function isOver(b) {
  const s = side(b)
  return s.startsWith("o") || s === "yes"
}

function isUnder(b) {
  const s = side(b)
  return s.startsWith("u") || s === "no"
}

function envOf(b) {
  return b && typeof b.environment === "object" && b.environment ? b.environment : {}
}

/** WHY classification — explain miss/overperformance using structural signals. */
function classifyMiss(bet, ctx) {
  const tags = []
  if (!bet) return tags
  const fam = statFamily(bet)
  const env = envOf(bet)
  const delta = num(ctx?.delta)
  const hit = ctx?.hit
  const overshot = Number.isFinite(delta) && delta > 0
  const undershot = Number.isFinite(delta) && delta < 0
  const big = Number.isFinite(delta) && Math.abs(delta) >= 1.5

  // Environment-driven tags (pulled from optional bet.environment fields).
  const pace = num(env.pace)
  const total = num(env.total ?? env.gameTotal)
  const spread = num(env.spread)
  const blowout = Number.isFinite(spread) && Math.abs(spread) >= 12
  if (pace != null && pace >= 102 && overshot) tags.push("pace spike")
  if (pace != null && pace <= 95 && undershot) tags.push("slow-pace suppression")
  if (total != null && total >= 232 && overshot) tags.push("high-total environment")
  if (total != null && total <= 215 && undershot) tags.push("low-total environment")
  if (blowout && undershot) tags.push("blowout suppression")

  // Foul trouble / minutes context (if slate exposed minutes / fouls).
  const fouls = num(env.fouls)
  const minutes = num(env.minutes ?? env.actualMinutes)
  if (fouls != null && fouls >= 5 && undershot) tags.push("foul trouble")
  if (Number.isFinite(minutes) && minutes <= 24 && undershot) tags.push("minutes capped")
  if (Number.isFinite(minutes) && minutes >= 38 && overshot) tags.push("minutes inflated")

  // Stat-family-specific patterns.
  if (fam === "rebounds") {
    if (env.transitionRate != null && num(env.transitionRate) >= 0.18 && overshot) {
      tags.push("transition environment")
    }
    if (env.oppMissedShots != null && num(env.oppMissedShots) >= 50 && overshot) {
      tags.push("rebound funnel")
    }
  } else if (fam === "threes") {
    if (env.spacing === "weak" && undershot) tags.push("weak-side spacing")
    if (env.touches != null && num(env.touches) <= 35 && undershot) tags.push("touch concentration miss")
  } else if (fam === "assists") {
    if (env.usageDelta != null && num(env.usageDelta) >= 4 && overshot) tags.push("heliocentric usage")
    if (blowout && undershot) tags.push("starter rest pattern")
  } else if (fam === "points" || fam === "pts" || fam === "pra") {
    if (env.defensiveMatchup === "elite" && undershot) tags.push("defensive matchup suppression")
  } else if (fam === "steals" || fam === "blocks") {
    if (overshot) tags.push("defensive playmaking spike")
  }

  // First-basket / first-shot family — opening possession intelligence tags.
  if (fam.includes("firstbasket") || fam.includes("firstshot") || fam === "first basket") {
    if (env.tipWinner != null && env.tipWinner !== bet.team && hit === false) {
      tags.push("first-basket tip-loss")
    }
    if (env.openingActionType && hit === false) {
      tags.push(`first-action: ${String(env.openingActionType)}`)
    }
    // First-touch ≠ first-shot distinction
    if (env.firstTouchPlayer && env.firstShotPlayer
        && env.firstTouchPlayer === bet.player
        && env.firstShotPlayer !== bet.player
        && hit === false) {
      tags.push("first-touch deferred")
    }
    // Scripted opener targeted a different archetype
    if (env.openingActionType && bet.firstBasketSnapshot?.archetype && hit === false) {
      const action = String(env.openingActionType).toLowerCase()
      const arch = String(bet.firstBasketSnapshot.archetype).toLowerCase()
      if (action.includes("post") && !arch.includes("post") && !arch.includes("jump_ball")) {
        tags.push("scripted-opener-mismatch")
      }
      if (action.includes("transition") && arch.includes("scripted")) {
        tags.push("transition-opener-script-miss")
      }
    }
    // Defensive mismatch exploited
    if (env.defensiveMismatch === true && hit === false) {
      tags.push("opening-defensive-mismatch")
    }
  }

  if (big && !tags.length) tags.push(overshot ? "outperformed projection" : "underperformed projection")
  return tags
}

/** Archetype hints — accumulate evidence; never authoritative. */
function detectArchetypes(bet, ctx) {
  const out = []
  if (!bet) return out
  const fam = statFamily(bet)
  const delta = num(ctx?.delta)
  const overshot = Number.isFinite(delta) && delta >= 1.5

  if (fam === "rebounds" && overshot) out.push("chaos rebounder")
  if (fam === "threes" && overshot) out.push("weak-side shooter")
  if (fam === "assists" && overshot) out.push("heliocentric initiator")
  if ((fam === "points" || fam === "pts") && overshot) out.push("transition scorer")
  if ((fam === "steals" || fam === "blocks") && overshot) out.push("defensive playmaker")

  // First-basket archetype reinforcement: when an FB bet hits, reinforce its
  // recorded archetype so the intel layer's archetype trust evolves over time.
  if ((fam.includes("firstbasket") || fam === "first basket") && ctx?.hit === true) {
    const arch = bet?.firstBasketSnapshot?.archetype
    if (typeof arch === "string" && arch && arch !== "balanced") out.push(arch)
  }

  // Stable / well-calibrated profile (small absolute delta on hit).
  if (Number.isFinite(delta) && Math.abs(delta) <= 0.5 && ctx?.hit === true) out.push("stable producer")

  return out
}

/** Environment tags pulled directly from the bet payload (no compute). */
function environmentTags(bet) {
  const env = envOf(bet)
  const out = []
  const pace = num(env.pace)
  if (pace != null) {
    if (pace >= 102) out.push("pace:high")
    else if (pace <= 95) out.push("pace:low")
    else out.push("pace:mid")
  }
  const total = num(env.total ?? env.gameTotal)
  if (total != null) {
    if (total >= 232) out.push("total:high")
    else if (total <= 215) out.push("total:low")
    else out.push("total:mid")
  }
  const spread = num(env.spread)
  if (Number.isFinite(spread) && Math.abs(spread) >= 12) out.push("blowout")
  if (env.playoffs === true) out.push("playoffs")
  return out
}

module.exports = { classifyMiss, detectArchetypes, environmentTags }
