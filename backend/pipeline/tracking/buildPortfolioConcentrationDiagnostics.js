"use strict"

/**
 * buildPortfolioConcentrationDiagnostics.js
 *
 * Anti-Monoculture Portfolio Intelligence V1.
 *
 * Pure diagnostic — reads a bestProps array, returns concentration metrics and
 * bettor-language warnings. No side effects. No scoring changes. Additive only.
 *
 * Returns:
 *   total, underExposurePct, overExposurePct,
 *   reboundsUnderExposurePct, threesUnderExposurePct,
 *   directionalConcentration, paceFragilityRisk,
 *   sameEnvironmentDependency,
 *   topConcentrationBuckets[], warnings[], structureHealthy
 *
 * Session AW.
 */

/**
 * @param {object[]} bestProps   Array of scored/graded prop objects from bestProps.
 * @returns {object}             Concentration diagnostics.
 */
function buildPortfolioConcentrationDiagnostics(bestProps) {
  const props = Array.isArray(bestProps) ? bestProps : []
  const total = props.length

  if (total === 0) {
    return {
      total: 0,
      underExposurePct:         0,
      overExposurePct:          0,
      reboundsUnderExposurePct: 0,
      threesUnderExposurePct:   0,
      directionalConcentration: 0,
      paceFragilityRisk:        "LOW",
      sameEnvironmentDependency: false,
      topConcentrationBuckets:  [],
      warnings:                 [],
      structureHealthy:         true,
    }
  }

  // ── Side exposure ─────────────────────────────────────────────────────────
  const unders = props.filter(p => String(p.side || "").toLowerCase() === "under")
  const overs  = props.filter(p => String(p.side || "").toLowerCase() === "over")
  const underPct = unders.length / total
  const overPct  = overs.length  / total

  // ── Per-(family|side) bucket counts ──────────────────────────────────────
  const buckets = {}
  for (const p of props) {
    const fam  = String(p.statFamily || p.propType || "").toLowerCase()
    const side = String(p.side || "").toLowerCase()
    const bk   = `${fam}_${side}`
    if (!buckets[bk]) {
      buckets[bk] = {
        key:    bk,
        family: fam,
        side,
        count:  0,
        pct:    0,
        label:  `${fam} ${side}s`,
      }
    }
    buckets[bk].count++
  }
  for (const b of Object.values(buckets)) {
    b.pct = Number((b.count / total).toFixed(3))
  }

  const rebUnderPct   = (buckets["rebounds_under"]?.count || 0) / total
  const threeUnderPct = (buckets["threes_under"]?.count   || 0) / total

  // ── Directional concentration ─────────────────────────────────────────────
  // 0 = perfectly balanced, 1 = fully one-sided
  const directionalConcentration = Number((Math.abs(underPct - 0.5) * 2).toFixed(2))

  // ── Pace fragility risk ───────────────────────────────────────────────────
  // Threes-unders partially hedge pace (volume-independent), reduce raw fragility.
  // A portfolio of threes-unders is less fragile to high-pace games than rebounds-unders.
  const paceFragilityRaw = underPct - (threeUnderPct * 0.5)
  const paceFragilityRisk = paceFragilityRaw > 0.65 ? "HIGH"
    : paceFragilityRaw > 0.45 ? "MODERATE"
    : "LOW"

  // ── Same-environment dependency ───────────────────────────────────────────
  // True when >70% of props require identical game script (all overs need high pace,
  // all unders need low-scoring grind).
  const sameEnvironmentDependency = underPct > 0.70 || overPct > 0.70

  // ── Warnings (bettor language) ────────────────────────────────────────────
  const warnings = []

  if (underPct > 0.70) {
    warnings.push(
      `Portfolio is ${Math.round(underPct * 100)}% unders — heavily dependent on a low-scoring game script. ` +
      `One high-pace blowout flips most of this slate.`
    )
  } else if (underPct > 0.60) {
    warnings.push(
      `Moderate under concentration (${Math.round(underPct * 100)}%) — watch pace and early-game scoring splits.`
    )
  }

  if (rebUnderPct > 0.20) {
    warnings.push(
      `Rebounds-under concentration at ${Math.round(rebUnderPct * 100)}% of portfolio — ` +
      `shared failure risk if either team rebounds at an elevated rate.`
    )
  }

  if (directionalConcentration > 0.50) {
    warnings.push(
      `High directional concentration (score: ${directionalConcentration}) — ` +
      `${Math.round(underPct > overPct ? underPct * 100 : overPct * 100)}% of props share the same side. ` +
      `Portfolio wins and losses will be highly correlated.`
    )
  }

  if (sameEnvironmentDependency) {
    warnings.push(
      `Current signal mix creates same-environment dependency — most props require the same game script to hit. ` +
      `Consider whether tonight's matchup favors that script.`
    )
  }

  if (paceFragilityRisk === "HIGH") {
    warnings.push(
      `Pace fragility risk: HIGH — portfolio is vulnerable to up-tempo game flow. ` +
      `Review projected pace and total before committing.`
    )
  }

  // Top concentration buckets for UI display
  const topConcentrationBuckets = Object.values(buckets)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)

  return {
    total,
    underExposurePct:          Number(underPct.toFixed(3)),
    overExposurePct:           Number(overPct.toFixed(3)),
    reboundsUnderExposurePct:  Number(rebUnderPct.toFixed(3)),
    threesUnderExposurePct:    Number(threeUnderPct.toFixed(3)),
    directionalConcentration,
    paceFragilityRisk,
    sameEnvironmentDependency,
    topConcentrationBuckets,
    warnings,
    structureHealthy: warnings.length === 0,
  }
}

module.exports = { buildPortfolioConcentrationDiagnostics }
