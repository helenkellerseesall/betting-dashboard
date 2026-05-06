"use strict"

/**
 * MLB adapter for the universal post-game review engine.
 *
 * Pure functions. NO file IO, NO mutation of inputs. Receives a tracked bet
 * (already merged with `actualStat` + optional `environment`) and returns
 * "why" tags / archetype hints / environment tags.
 *
 * No hardcoded players. All logic is structural (stat family, line, side,
 * environment fields supplied by the slate, e.g. impliedTeamTotal, park,
 * weather, batting order, opposing pitcher hand).
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

function envOf(b) {
  return b && typeof b.environment === "object" && b.environment ? b.environment : {}
}

function classifyMiss(bet, ctx) {
  const tags = []
  if (!bet) return tags
  const fam = statFamily(bet)
  const env = envOf(bet)
  const delta = num(ctx?.delta)
  const hit = ctx?.hit
  const overshot = Number.isFinite(delta) && delta > 0
  const undershot = Number.isFinite(delta) && delta < 0
  const big = Number.isFinite(delta) && Math.abs(delta) >= 1

  // Park / weather environment tags.
  const parkFactor = num(env.parkFactor ?? env.hrFactor)
  const windOut = env.windOut === true
  const windIn = env.windIn === true
  const temp = num(env.temperature)
  if (parkFactor != null && parkFactor >= 1.1 && overshot) tags.push("hitter park boost")
  if (parkFactor != null && parkFactor <= 0.9 && undershot) tags.push("pitcher park suppression")
  if (windOut && overshot) tags.push("wind-out boost")
  if (windIn && undershot) tags.push("wind-in suppression")
  if (Number.isFinite(temp) && temp <= 50 && undershot) tags.push("cold weather suppression")
  if (Number.isFinite(temp) && temp >= 80 && overshot) tags.push("warm weather boost")

  // Lineup spot.
  const bo = num(env.battingOrder ?? env.lineupPosition)
  if (Number.isFinite(bo)) {
    if (bo <= 3 && overshot) tags.push("top lineup opportunity")
    if (bo >= 8 && undershot) tags.push("bottom lineup opportunity")
  }

  // Bullpen exposure.
  const bullpenIp = num(env.bullpenInningsExposed)
  if (Number.isFinite(bullpenIp) && bullpenIp >= 4 && overshot) tags.push("bullpen exposure")

  // Implied team total / handedness.
  const itt = num(env.impliedTeamTotal)
  if (Number.isFinite(itt) && itt >= 5 && overshot) tags.push("high implied team total")
  if (Number.isFinite(itt) && itt <= 3 && undershot) tags.push("low implied team total")
  if (env.platoonAdvantage === true && overshot) tags.push("handedness exploit")
  if (env.platoonAdvantage === false && undershot) tags.push("handedness disadvantage")

  // Stat-family-specific.
  if (fam === "hr") {
    if (overshot && parkFactor != null && parkFactor >= 1.1) tags.push("hr park-aided")
    if (overshot && env.barrelRate != null && num(env.barrelRate) >= 12) tags.push("hr barrel profile")
  } else if (fam === "ks") {
    const oppKRate = num(env.opposingTeamKRate)
    const expected = num(bet.expectedKs ?? env.expectedKs)
    if (overshot && Number.isFinite(oppKRate) && oppKRate >= 0.26) tags.push("strikeout matchup")
    if (undershot && Number.isFinite(expected) && Number.isFinite(num(bet.actualStat))) {
      const a = num(bet.actualStat)
      if (a != null && a + 2 <= expected) tags.push("pitcher early hook")
    }
  } else if (fam === "rbis") {
    if (overshot && Number.isFinite(itt) && itt >= 5) tags.push("rbi opportunity environment")
    if (undershot && Number.isFinite(bo) && bo >= 7) tags.push("rbi opportunity drought")
  } else if (fam === "totalbases" || fam === "tb") {
    if (overshot && parkFactor != null && parkFactor >= 1.1) tags.push("tb park-aided")
  }

  // Variance fallback.
  if (big && !tags.length) tags.push(overshot ? "variance spike (over)" : "variance spike (under)")
  if (hit === false && Math.abs(num(delta) ?? 0) <= 0.5) tags.push("near-line miss")
  return tags
}

function detectArchetypes(bet, ctx) {
  const out = []
  if (!bet) return out
  const fam = statFamily(bet)
  const delta = num(ctx?.delta)
  const overshot = Number.isFinite(delta) && delta >= 1
  const env = envOf(bet)

  if (fam === "hr" && overshot) out.push("volatility slugger")
  if ((fam === "hits" || fam === "totalbases" || fam === "tb") && overshot) out.push("contact stabilizer")
  if (fam === "rbis" && overshot && num(env.battingOrder) <= 4) out.push("lineup opportunity booster")
  if (fam === "ks" && overshot) out.push("high-K pitcher")
  if (env.platoonAdvantage === true && overshot && (fam === "hits" || fam === "hr" || fam === "totalbases" || fam === "tb")) {
    out.push("platoon masher")
  }
  if (Number.isFinite(delta) && Math.abs(delta) <= 0.5 && ctx?.hit === true) out.push("stable producer")
  return out
}

function environmentTags(bet) {
  const env = envOf(bet)
  const out = []
  const parkFactor = num(env.parkFactor ?? env.hrFactor)
  if (parkFactor != null) {
    if (parkFactor >= 1.1) out.push("park:hitter")
    else if (parkFactor <= 0.9) out.push("park:pitcher")
    else out.push("park:neutral")
  }
  if (env.windOut === true) out.push("wind:out")
  else if (env.windIn === true) out.push("wind:in")
  const temp = num(env.temperature)
  if (Number.isFinite(temp)) {
    if (temp <= 50) out.push("temp:cold")
    else if (temp >= 80) out.push("temp:warm")
    else out.push("temp:mid")
  }
  const itt = num(env.impliedTeamTotal)
  if (Number.isFinite(itt)) {
    if (itt >= 5) out.push("itt:high")
    else if (itt <= 3) out.push("itt:low")
    else out.push("itt:mid")
  }
  if (env.platoonAdvantage === true) out.push("platoon:advantage")
  if (env.platoonAdvantage === false) out.push("platoon:disadvantage")
  return out
}

module.exports = { classifyMiss, detectArchetypes, environmentTags }
