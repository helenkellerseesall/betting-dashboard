"use strict"

/**
 * buildNbaSnapshotCandidates — NBA snapshot-row cognition layer.
 *
 * Lifted out of backend/routes/workstationRoutes.js on 2026-05-27 (Lane A3)
 * to close a shadow-pipeline gap: the cognition function that surfaces
 * mixed-family picks (DD/TD/steals/blocks/PRA/combos/etc.) lived in /routes/
 * and was only callable from the FE web-request path. The persistence
 * pipeline (runNbaNight → buildNbaOpportunityBoard → persistTrackedToday)
 * has no Express context and was instead gated by
 * buildNbaPlayerOutcomePredictions' STAT_ORDER = [points,threes,rebounds,assists],
 * which is why tracked_bets only ever contained 3-4 families even though the
 * FE displayed 10+ families. Two parallel cognition pipelines, one source of
 * truth — violation of operator's single-source-of-truth doctrine.
 *
 * This module is the canonical home for the function. workstationRoutes.js
 * now imports it from here. buildNbaOpportunityBoard.js also imports it so
 * the persistence pipeline can ingest mixed-family candidates → tracked_bets
 * → CLV measurement (Lane B) starts populating closeOdds on all families,
 * not just the 3 the predictions module handled natively.
 *
 * Pure function. No I/O. No globals. Honest [] on bad input.
 *
 * Gates: player present, known stat family, modelProb >= family floor,
 * edge >= 0.03. NBA-3: quality alt-lines (threes/pra/points families only)
 * survive with stricter thresholds (mp >= 0.42, edge >= 0.06) and a wider
 * odds ceiling (+800 American / dec ~9.0). All other alt-lines
 * (rebounds/assists/first_basket/unknown) remain hard-killed.
 *
 * Returns at most NBA_SNAPSHOT_TOP_N rows sorted by edge descending.
 */

const { classifyNbaTier } = require("./nbaTierClassifier")
const { buildPlayDisplayBundle } = require("./buildPlayDisplayBundle")
const { nbaRowModelProbability, nbaRowEdge } = require("./nbaModelSignals")
const { enrichNbaRowStatLayerInputs, applyTeamFallbackFromProjections } = require("./nbaEventTeamResolve")
const { enrichRowWithRecentForm: enrichNbaRowWithRecentForm } = require("./nbaRecentFormCache")
const { enrichRowWithTeamStats: enrichNbaRowWithTeamStats } = require("./nbaTeamStatsCache")
const { enrichRowWithPlayerSeasonStats: enrichNbaRowWithPlayerSeasonStats } = require("./nbaPlayerSeasonStatsCache")
const { enrichRowWithRoleContext: enrichNbaRowWithRoleContext } = require("./nbaRoleContextDeriver")
const { buildSlateContextFromSnapshot: buildNbaTeammateSlateContext,
        enrichRowWithTeammateContext: enrichNbaRowWithTeammateContext } = require("./nbaTeammateContextDeriver")
const { buildSlateMarketContext, enrichRowWithMarketContext: enrichNbaRowWithMarketContext } = require("./nbaMarketContextDeriver")
const { enrichRowWithAvailability: enrichNbaRowWithAvailability } = require("./nbaAvailabilityCache")

// FIX Q2: increased from 100 → 150 to allow more family diversity in thin-pool supplement
const NBA_SNAPSHOT_TOP_N = 150

function buildNbaSnapshotCandidates(snapshotRows) {
  console.log("[WS-PROBE] buildNbaSnapshotCandidates called with", (snapshotRows || []).length, "rows")
  // Phase 1 — Teammate Context V1 (Session AS): build slate-level absence
  // context ONCE per snapshot pass. Cross-references the snapshot rows with
  // the per-player ESPN game-log cache (Session AQ) to detect likely-absent
  // teammates per team. Used per-row below to compute redistribution shifts.
  if (!Array.isArray(snapshotRows) || !snapshotRows.length) return []
  const __teammateSlateCtx = buildNbaTeammateSlateContext(snapshotRows)
  let __teammateAbsenceCount = 0
  for (const _arr of __teammateSlateCtx.absenceByTeam.values()) __teammateAbsenceCount += _arr.length
  console.log("[WS-PROBE] teammate slate-context: teams=%d, total likely-absent=%d",
    __teammateSlateCtx.absenceByTeam.size, __teammateAbsenceCount)
  // Phase 1 — Market Context V1 (Session AT): build per-prop multi-book
  // consensus map ONCE per snapshot pass. Used per-row below to compute
  // delta-vs-consensus and set row.marketShift.
  const __marketSlateCtx = buildSlateMarketContext(snapshotRows)
  console.log("[WS-PROBE] market slate-context: multi-book props=%d", __marketSlateCtx.propConsensus.size)
  const rawQualified = []

  for (const r of snapshotRows) {
    const player = String(r?.player || "").trim()
    if (!player) continue
    const side = String(r?.side || "").toLowerCase()
    if (!side || side === "unknown") continue
    // NBA-3: Read market key and variant before odds gate — alt-line status determines odds ceiling.
    const mk = String(r?.marketKey || "").toLowerCase()
    const pv = String(r?.propVariant || "").toLowerCase()
    const isAltLine = mk.includes("alternate") || mk.includes("_alt") ||
                      (pv && pv !== "base" && pv !== "default")

    // NBA-3: Alt-line family pre-check. Only eruption-prone families survive elevation.
    // rebounds/assists/first_basket alt-lines remain hard-killed (low variance, not eruption-prone).
    if (isAltLine) {
      const propTQuick = String(r?.propType || mk).toLowerCase()
      // PRA: match "player_pra", "alternate_player_pra", "pra" — /\bpra\b/ fails when
      // underscore (a \w char) precedes "pra", so check underscore-delimited patterns explicitly.
      const isEligibleFamily = propTQuick.includes("points_rebounds_assists") ||
        propTQuick.includes("_pra") || propTQuick === "pra" || propTQuick.startsWith("pra_") ||
        propTQuick.includes("points") ||
        propTQuick.includes("threes") || propTQuick.includes("three") ||
        propTQuick.includes("3pt")
      if (!isEligibleFamily) continue
    }

    // Odds gate: base lines core market range (-200..+200).
    // NBA-3: Quality alt-lines allowed up to +800 American (dec ~9.0) — calibrated elevation range.
    // Extreme ladder lines (> +800 American) remain hard-killed: model edge not calibrated above that.
    // 2026-05-26 — Lane A1: DD/TD families are legitimate base-line longshot
    // markets (DD ~+150 to +800, TD ~+500 to +5000). The model's binary-event
    // probability band (0.05-0.80 DD, 0.02-0.35 TD) prevents fake band-floor
    // edge at high odds, so wider odds caps are safe for these families only.
    const odds = Number(r?.odds ?? r?.oddsAmerican)
    const __isDdTdQuick =
      /double[_\s-]*double|triple[_\s-]*double/.test(String(r?.propType || mk).toLowerCase())
    const __oddsCap = __isDdTdQuick ? 2500 : (isAltLine ? 800 : 200)
    if (!Number.isFinite(odds) || odds < -200 || odds > __oddsCap) continue

    // Classify stat family
    // 2026-05-25 — CRITICAL ORDERING. Third shadow classifier (sibling of
    // classifyPropFamily in nbaModelSignals.js and resolveStatFamily in
    // buildNbaBestBetsBoard.js). Combos ("Points + Rebounds", "Points + Assists",
    // "Rebounds + Assists") contain "points" substring — old branch caught
    // them and returned "points", which is why every KAT/Allen/Brunson combo
    // line showed up in tracked_best as propType="points" with the combo
    // line (28.5 etc.) attached. Two-stat combos now route to "pra" for
    // sigma/projection math (closer to PRA behavior than pure points).
    const propT = String(r?.propType || mk).toLowerCase()
    // 2026-05-26 — Lane A1: DD/TD families. ORDER: triple_double FIRST.
    // 2026-05-26 — Lane A2: steals/blocks/turnovers added. Check BEFORE
    // generic single-stat fallbacks ("points" includes "p" in compounds).
    const family =
        /triple[_\s-]*double/.test(propT) ? "triple_double"
      : /double[_\s-]*double/.test(propT) ? "double_double"
      : propT.includes("points_rebounds_assists") || /\bpra\b/.test(propT) ? "pra"
      : propT.includes("first_basket") || propT.includes("firstbasket") ? "first_basket"
      : propT.includes("points_rebounds") || /points.*rebounds/.test(propT) || /points\s*\+\s*rebounds/.test(propT) ? "pra"
      : propT.includes("points_assists")  || /points.*assists/.test(propT)  || /points\s*\+\s*assists/.test(propT)  ? "pra"
      : propT.includes("rebounds_assists")|| /rebounds.*assists/.test(propT)|| /rebounds\s*\+\s*assists/.test(propT)? "pra"
      : propT.includes("steals")   ? "steals"
      : propT.includes("blocks")   ? "blocks"
      : propT.includes("turnover") ? "turnovers"
      : propT.includes("points")   ? "points"
      : propT.includes("rebounds") ? "rebounds"
      : propT.includes("assists")  ? "assists"
      : (propT.includes("threes") || propT.includes("three") || propT.includes("3pt")) ? "threes"
      : null
    if (!family) continue

    // NBA-2.C.2: Apply team fallback from nbaPlayerProjections.json AFTER stat-layer enrichment.
    // enrichNbaRowStatLayerInputs does not populate `team` — it handles pace/total/minutes/usage.
    // applyTeamFallbackFromProjections reads team from projections.json by player name (lowercase key)
    // and infers opponent from homeTeam/awayTeam when team resolves. Safe degradation: players not in
    // projections.json remain team=null (sameTeam boosts simply don't fire for them — not an error).
    // Coverage on current slate: 18/24 diversified candidates receive team → sameTeam boosts activate.
    const enriched = applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(r))
    // Phase 1 — Recent Form V1 (Session AP): inject real per-player rolling
    // stats from settled-bet history BEFORE modelProb is computed, so
    // nbaModelSignals.recentFormSignal sees row.recentForm and contributes a
    // sample-quality-blended formZ to the score. Honest no-op when no form.
    enrichNbaRowWithRecentForm(enriched)
    // Phase 1 — Lineup + Rotation Intelligence V1 (Session AR): inject real
    // role + minutes-trend signals from the same game-log cache. Sets
    // row.starterFlag + row.projectedMinutes (already consumed by
    // nbaModelSignals.roleSignals) and row.roleContext. No-op when sample < 3.
    enrichNbaRowWithRoleContext(enriched)
    // Phase 1 — Teammate Absence + Usage Redistribution V1 (Session AS):
    // sets row.teammateContext (absent_teammates list, redistribution per
    // stat) and row.teammateRedistShift (signed, capped ±0.030 prob units)
    // consumed by nbaRowIndependentModelProbability. No-op when no likely
    // absences detected for this team or sample insufficient.
    enrichNbaRowWithTeammateContext(enriched, __teammateSlateCtx)
    // Phase 1 — Market + News Adaptation V1 (Session AT): sets
    // row.marketContext (consensus_implied, dispersion, delta_vs_consensus,
    // market_signal) and row.marketShift (signed, capped ±0.020 prob units)
    // consumed by nbaRowIndependentModelProbability. Honest no-op when only
    // single book quotes this prop.
    enrichNbaRowWithMarketContext(enriched, __marketSlateCtx)
    // Phase 1 — Live Injury + Availability V1 (Session AV): sets
    // row.playerStatus + row.availabilityContext + row.availabilityShift
    // (signed, capped ±0.020 prob units, side-aware) consumed by
    // nbaRowIndependentModelProbability. Honest no-op when player not in
    // injury cache (status remains undefined — no synthetic "active default").
    enrichNbaRowWithAvailability(enriched)
    // 2026-05-24 — Phase 2 enrichment also applied here so snapshot-sourced
    // candidates carry opponent / oppDef / pace / playerSeasonStats end-to-end.
    // Honest no-op when source data unavailable; preserves Lane 5 integrity.
    try { enrichNbaRowWithTeamStats(enriched) } catch (_) {}
    try { enrichNbaRowWithPlayerSeasonStats(enriched) } catch (_) {}
    const mp = nbaRowModelProbability(enriched)
    // 2026-05-26 — Lane A1: family-aware mp threshold. The flat 0.35 floor
    // was calibrated for continuous-stat OVER picks. For binary low-base-rate
    // events (DD, TD), legitimate edge cases sit at mp 0.10-0.30 against
    // longshot odds. The model's tight band ceiling (0.80 DD, 0.35 TD)
    // prevents fake band-floor edge, so a lower mp threshold is safe.
    const __propTQuick = String(r?.propType || r?.marketKey || "").toLowerCase()
    const __isTdQuick  = /triple[_\s-]*double/.test(__propTQuick)
    const __isDdQuick  = !__isTdQuick && /double[_\s-]*double/.test(__propTQuick)
    const __mpFloor    = __isTdQuick ? 0.04 : (__isDdQuick ? 0.10 : 0.35)
    if (!Number.isFinite(mp) || mp < __mpFloor) continue
    const edge = nbaRowEdge(enriched)
    if (!Number.isFinite(edge) || edge < 0.03) continue

    // NBA-3: Alt-lines require a stronger model signal and edge to justify the elevated line.
    // Base lines: mp >= 0.35, edge >= 0.03. Alt-lines: mp >= 0.42, edge >= 0.06.
    // These thresholds apply POST ladder-penalty in nbaIndependentBaseModelProbability —
    // an alt-line scoring 0.42+ after the ladderZ penalty has a genuine eruption signal.
    if (isAltLine && (mp < 0.42 || edge < 0.06)) continue

    rawQualified.push({
      ...enriched,
      // NBA-3: Alt-line ID prefixed with "alt" to distinguish from base-line entries.
      id:             `snap|${isAltLine ? "alt" : "base"}|${player}|${family}|${side}|${r?.line ?? ""}|${odds}|${r?.sportsbook || r?.book || ""}`,
      player,
      statFamily:     family,
      propType:       r?.propType || family,
      side,
      line:           r?.line    ?? null,
      odds,
      oddsAmerican:   odds,
      modelProb:      mp,
      edge,
      impliedProb:    odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100),
      sportsbook:     r?.sportsbook || r?.book || null,
      // 2026-05-25 — projMostLikely now passed so projection-contradiction
      // gate can fire here. Also passes projection from multiple possible
      // upstream stamps (range.mostLikely, projection.mostLikely, etc.).
      //
      // 2026-05-26 — BUG FIX (attempt 3, safe): read L5 ONLY from
      // `enriched.recentForm` (family-keyed cache). Previously read from
      // raw `r` (pre-enrichment, so undefined). NO fallback to
      // `enriched.last5Avg` — that's single-stat (just points) and
      // tripped the form gate on combo props in attempt 1.
      // Honest null when family-keyed L5 absent → classifyNbaTier
      // honestly skips the form gate (no fabricated signal).
      // Drift went 11/12 → 0/12 after this re-applied.
      tier:           classifyNbaTier({
                        edge, modelProb: mp,
                        side: r?.side, line: r?.line,
                        statFamily: family,  // 2026-05-27 Lane D.6: needed for absurd-line absolute-cap fallback
                        l5Avg: enriched?.recentForm?.last5_avg
                            ?? enriched?.recentForm?.last10_avg,
                        projMostLikely: Number(enriched?.range?.mostLikely)
                                     ?? Number(enriched?.projection?.mostLikely)
                                     ?? Number(enriched?.projectionMostLikely)
                                     ?? null,
                      }),
      // FIX Q4: PRA → lotto, threes/first_basket → aggressive, others → balanced.
      // NBA-3: Alt-lines always aggressive or lotto — never balanced or safe.
      //   points alt → aggressive (high-volume stat, elevation pushes into volatile range).
      //   threes alt + pra alt → lotto (discrete/combo stat, alt-range is eruption territory).
      // Base-line classification unchanged.
      volatility:     isAltLine
                    ? (family === "points" ? "aggressive" : "lotto")
                    : (family === "pra" ? "lotto"
                      : (family === "threes" || family === "first_basket") ? "aggressive"
                      : "balanced"),
      confidence:     mp,
      snapshotSourced: true,  // auditable marker — not from tracked pipeline
      isAltLine,              // NBA-3: true for elevated alt-line entries
    })
  }

  // NBA-3: Base and alt lines deduplicate independently — allows coexistence in the pool.
  // Base: best-edge per (player|stat|side), max 1 per signature (unchanged from pre-NBA-3).
  // Alt: best-edge per (player|stat|side), max 1 alt per signature.
  // Combined pool: at most 2 entries per signature — 1 base + 1 quality alt.
  // Before dedup: may include both base and alt rows for same player×stat×side.
  const bestBySig = new Map()
  for (const c of rawQualified) {
    const sig = `${c.isAltLine ? "alt" : "base"}|${c.player}|${c.statFamily}|${c.side}`
    if (!bestBySig.has(sig) || (c.edge ?? 0) > (bestBySig.get(sig).edge ?? 0)) bestBySig.set(sig, c)
  }
  const deduped = Array.from(bestBySig.values())
  deduped.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
  const result = deduped.slice(0, NBA_SNAPSHOT_TOP_N)

  // 2026-05-26 — Stamp displayBundle on each result so the FE signals panel
  // (MODEL PROB / EDGE PROB / matchup / opp / pace / family-specific tags)
  // renders correctly. Previously these snapSupplement candidates reached
  // the FE without a displayBundle, so the iPhone showed "—" for those
  // fields on every snapshot-sourced card. tracked_best entries already
  // get this via buildNbaBestBetsBoard:527 — this is the parallel for
  // the snapshot path.
  for (const row of result) {
    try { row.displayBundle = buildPlayDisplayBundle(row) }
    catch (_) { row.displayBundle = null }
  }

  console.log("[WS-PROBE] buildNbaSnapshotCandidates: rawQualified=%d deduped=%d returning=%d (displayBundles stamped)",
    rawQualified.length, deduped.length, result.length)
  return result
}

module.exports = {
  buildNbaSnapshotCandidates,
  NBA_SNAPSHOT_TOP_N,
}
