"use strict"

/**
 * Stat-specific weight nudges (NBA): role, usage, opponent defensive shape, environment.
 * Applied only as a small multiplier in computeFinalWeight — does not replace the model.
 */

const { inferRoleBucket, resolveDefenseProfile, readPaceTotal } = require("./nbaMatchupIntelligence")

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v))
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {{ matchupRow: object, propType: string, usageRate: number|null, minutes: number|null, threesBaseLine: number|null, line: number|null }} ctx
 * @returns {number} adjustment in roughly [-0.07, 0.07] to use as w *= (1 + adj)
 */
function computeStatSpecificAdjustmentFromContext(ctx) {
  const matchupRow = ctx?.matchupRow
  if (!matchupRow || typeof matchupRow !== "object") return 0

  const propType = ctx?.propType || matchupRow?.propType || matchupRow?.marketKey || ""
  const pt = String(propType).toLowerCase()
  const u = Number.isFinite(Number(ctx?.usageRate)) ? Number(ctx.usageRate) : 22
  const m = Number.isFinite(Number(ctx?.minutes)) ? Number(ctx.minutes) : 28
  const threesBaseLine = toNum(ctx?.threesBaseLine)

  const opponent = String(matchupRow.opponent || matchupRow.opponentTeam || "").trim()
  const profile = opponent ? resolveDefenseProfile(opponent) : null
  const role = inferRoleBucket({ ...matchupRow, propType })
  const { pace, total } = readPaceTotal(matchupRow)

  let adj = 0

  // --- REBOUNDS (not PRA combo) ---
  if (/rebound/.test(pt) && !/pra|points.*rebounds.*assists|pts.*reb.*ast|player_points_rebounds/.test(pt)) {
    const gl = profile ? profile.vsGlass : 0
    if (role === "big") adj += -gl * 0.082
    else if (role === "guard") adj += -gl * 0.098
    else adj += -gl * 0.072

    if (Number.isFinite(pace)) {
      adj += clamp(-0.018, 0.018, ((pace - 100) / 14) * 0.014)
    }
  }

  // --- ASSISTS (not PRA) ---
  if (/assist/.test(pt) && !/pra|points.*rebounds|pts.*reb.*ast|player_points_rebounds/.test(pt)) {
    const primaryCreator = u >= 25 || (role === "guard" && u >= 22)
    if (primaryCreator) adj += 0.038
    else adj -= 0.042

    if (Number.isFinite(pace)) {
      adj += clamp(-0.022, 0.022, ((pace - 100) / 14) * 0.016)
    }
    if (Number.isFinite(total)) {
      adj += clamp(-0.025, 0.025, ((total - 224) / 28) * 0.02)
    }
  }

  // --- THREES (refinement; base ladder already has a role factor earlier in computeFinalWeight) ---
  if (/three|threes|3pt/.test(pt)) {
    if (Number.isFinite(threesBaseLine)) {
      if (threesBaseLine >= 3.2) adj += 0.045
      else if (threesBaseLine >= 2.5) adj += 0.024
      else if (threesBaseLine <= 1.5) adj -= 0.055
      else if (threesBaseLine <= 2.0) adj -= 0.03
    } else if (u < 22 || m < 28) {
      adj -= 0.034
    }

    if (profile) adj += -profile.vsPerimeter * 0.06
    if (role === "big") adj -= 0.026
  }

  // --- PRA: versatility proxy (minutes + usage) ---
  if (/pra|points.*rebounds.*assists|pts.*reb.*ast/.test(pt)) {
    if (u >= 24 && m >= 32) adj += 0.044
    else if (u < 21 || m < 27) adj -= 0.048
    else if (u >= 22 && m >= 30) adj += 0.02
  }

  return clamp(-0.07, 0.07, adj)
}

module.exports = {
  computeStatSpecificAdjustmentFromContext,
}
