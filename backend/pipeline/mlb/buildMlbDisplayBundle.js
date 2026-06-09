"use strict"

/**
 * buildMlbDisplayBundle — Step-2 MLB pick stat-backing + why-this-pick bundle.
 *
 * 2026-06-08 — MLB sibling of NBA buildPlayDisplayBundle.js. Assembles a
 * structured, ALL-NULL-GUARDED bundle from fields ALREADY enriched onto the
 * candidate `best` row (pitcherEnvironmentContext / batterStats / parkContext /
 * weatherContext / lineupContextV2 / contextualTags) plus a cheap L5/L15
 * form-cache lookup. Spec: docs/audits/2026-06-07-prop-coverage/
 * step2_statbacking_map_mlb.md + step2_displaybundle_phase0.md (operator-approved §3 schema).
 *
 * ANTI-FABRICATION (probabilityHonesty / betting-dashboard-invariants): every
 * field is null-guarded — a missing/null source value is OMITTED, never
 * defaulted to 0 or invented. `pruneNull` drops absent keys so the FE never
 * renders a fabricated number. modelProb shown is `predictedProbability`, which
 * is ALREADY calibration-dampened upstream (calibrationFeedback wire) — an
 * honest number, NOT a fake confidence %. "won X% of N similar" is a v2 corpus
 * lookup, intentionally NOT in v1.
 *
 * Pure function: reads the row + the file-backed form cache (no network, no
 * mutation of the input row). The kill-switch (MLB_DISPLAY_BUNDLE) lives at the
 * single attach site (server.js) — when OFF, this is never called and no
 * `displayBundle` key appears anywhere (byte-identical to pre-Step-2).
 */

let _getBatterForm = null
try {
  _getBatterForm = require("./mlbBatterFormCache").getBatterForm
} catch (_) {
  _getBatterForm = null
}

// Trap-1 guard: null/undefined MUST stay null (omitted), NEVER coerce to 0 —
// Number(null)===0 would fabricate a "0 velocity / 0 rest" on the card. Only a
// real finite number passes; everything else (null, undefined, NaN, "") → null.
const num = (v) => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Drop keys whose value is null/undefined (anti-fabrication: absent ⇒ omitted).
// Returns null if the resulting object is empty (so the parent can omit it too).
function pruneNull(obj) {
  if (!obj || typeof obj !== "object") return null
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue
    out[k] = v
  }
  return Object.keys(out).length ? out : null
}

function buildMlbDisplayBundle(row) {
  if (!row || typeof row !== "object") return null

  const pe = row.pitcherEnvironmentContext && typeof row.pitcherEnvironmentContext === "object" ? row.pitcherEnvironmentContext : null
  const bs = row.batterStats && typeof row.batterStats === "object" ? row.batterStats : null
  const pc = row.parkContext && typeof row.parkContext === "object" ? row.parkContext : null
  const wc = row.weatherContext && typeof row.weatherContext === "object" ? row.weatherContext : null
  const lc = row.lineupContextV2 && typeof row.lineupContextV2 === "object" ? row.lineupContextV2 : null

  // L5 / L15 recent form (file cache; no network). Honesty: absent ⇒ null.
  let recentForm = null
  if (typeof _getBatterForm === "function" && row.player) {
    try {
      const l5 = _getBatterForm(row.player, 5) || null
      const l15 = _getBatterForm(row.player, 15) || null
      if (l5 || l15) recentForm = pruneNull({ l5, l15 })
    } catch (_) { recentForm = null }
  }

  // ── STAT-BACKING (the matchup math) ──────────────────────────────────────
  const statBacking = pruneNull({
    opposingPitcher: pe && pe.pitcherName ? pruneNull({
      name: pe.pitcherName,
      kRate: num(pe.kRate), gbRate: num(pe.gbRate), fbRate: num(pe.fbRate),
      velocityMph: num(pe.velocityMph), restDays: num(pe.restDays),
      fatigueFlag: typeof pe.fatigueFlag === "boolean" ? pe.fatigueFlag : null,
      kEnvironmentShift: num(pe.kEnvironmentShift),
    }) : null,
    seasonLine: bs ? pruneNull({
      avg: num(bs.avg), obp: num(bs.obp), slg: num(bs.slg), ops: num(bs.ops),
      iso: num(bs.iso), kRate: num(bs.kRate), hrRate: num(bs.hrRate),
    }) : null,
    recentForm,
    // parkContext has NO hitsFactor field — only hr/doubles/triples are real.
    park: pc ? pruneNull({
      hrFactor: num(pc.hrFactor), doublesFactor: num(pc.doublesFactor),
      triplesFactor: num(pc.triplesFactor), hrEnvironmentTag: pc.hrEnvironmentTag ?? null,
    }) : null,
    platoon: pruneNull({
      isPlatoonAdvantage: typeof row.isPlatoonAdvantage === "boolean" ? row.isPlatoonAdvantage : null,
      batterHand: row.batterHand ?? bs?.batSide ?? null,
      pitcherHand: row.pitcherHand ?? null,
    }),
    weather: wc ? pruneNull({
      windDirectionTag: wc.windDirectionTag ?? null, windSpeedMph: num(wc.windSpeedMph),
      carryShift: num(wc.carryShift), temperatureF: num(wc.temperatureF),
      isIndoor: typeof wc.isIndoor === "boolean" ? wc.isIndoor : null,
    }) : null,
    // lineup: NULL-GUARD — only ~22% confirmed; "pending" when absent, never blank-as-0.
    lineup: (() => {
      const spot = num(lc?.lineupSpot) ?? num(row.lineupSpot) ?? num(row.lineupPosition) ?? num(row.battingOrderIndex)
      const depth = num(lc?.depth) ?? num(row.depth)
      const confirmed = Number.isFinite(spot)
      return pruneNull({ spot, depth, status: confirmed ? "confirmed" : "pending" })
    })(),
  })

  // ── WHY-THIS-PICK (why it surfaced as a top pick) ────────────────────────
  const whyThisPick = pruneNull({
    edge: num(row.edgeProbability ?? row.edge),
    tier: row.tier ?? null,
    bucket: row.bucket ?? null,
    volatility: row.volatility ?? null,
    // calibration-dampened model prob (NOT raw, NOT a fake confidence %)
    modelProb: num(row.predictedProbability ?? row.modelProb),
    impliedProb: num(row.impliedProbability ?? row.impliedProb),
    mlbPhase3Score: num(row.mlbPhase3Score),
    contextualTags: Array.isArray(row.mlbContextualTags) ? row.mlbContextualTags
                  : (Array.isArray(row.contextualTags) ? row.contextualTags : null),
  })

  // ── NOT-WIRED (honest markers — never faked) ─────────────────────────────
  // liveNews: no feed exists (operator-approved label). lineupConfirmation:
  // structured confirmed/pending from lineup presence (v1); scratched-detection
  // (deriveMlbStarterConfirmationState, needs slate maps) is a v2 — the Phase-1b
  // live-state layer already GUARDS scratches separately.
  const lineupConfirmed = Number.isFinite(num(lc?.lineupSpot) ?? num(row.lineupSpot) ?? num(row.lineupPosition) ?? num(row.battingOrderIndex))
  const notWired = {
    liveNews: "not_wired",
    lineupConfirmation: lineupConfirmed ? "confirmed" : "pending",
  }

  return {
    _version: "mlb-v1",
    ...(statBacking ? { statBacking } : {}),
    ...(whyThisPick ? { whyThisPick } : {}),
    notWired,
  }
}

module.exports = { buildMlbDisplayBundle }
