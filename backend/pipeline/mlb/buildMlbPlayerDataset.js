"use strict"

const normalizeName = require("../../utils/normalizeName")

// 2026-06-12 T2-L1 (mlb-nb-ladder-v1) — NegBinom SHADOW ladder kill-switch.
// Read ONCE at module load (MLB_BUCKET_TIER_POLICY pattern). unset/"1" → ON;
// ONLY the exact string "0" → OFF. OFF ⇒ projectHitterStats emits NO ladderNB
// key ⇒ predictions byte-identical to pre-T2-L1. SHADOW FIELD doctrine: ladderNB
// is consumed by NOTHING in scoring (verifier-enforced in verifyNbLadderStep1) —
// it exists to be VALIDATED against realized outcomes during the R2 scoring
// freeze before any governed swap. Evidence + plan:
// docs/audits/2026-06-12-t2-ladders/step1_audit_plan.md
const NB_LADDER_ON = String(process.env.MLB_NB_LADDER ?? "1") !== "0"
try {
  console.log(`[NB-LADDER-BOOT] MLB NegBinom shadow ladder ${NB_LADDER_ON ? "ON (default) — mlb-nb-ladder-v1, shadow-only" : "OFF — MLB_NB_LADDER=0, pre-T2-L1-identical"}`)
} catch (_) { /* no-op */ }
const { ladderFromLogs: _nbLadderFromLogs } = require("./negBinomLadder")

// T2-L1 — lazy batter-gamelog cache for the NB fit (mirrors
// pipeline/shared/playerPropHistory.js: same file, same normPlayer keying,
// same 5-min TTL). Lookup miss / thin sample ⇒ null ⇒ NO field (honesty).
let _nbLogCache = null
let _nbLogCacheAt = 0
let _nbNormPlayer
try { _nbNormPlayer = require("../../storage/intelligence").normPlayer }
catch (_) { _nbNormPlayer = (s) => String(s || "").toLowerCase().trim() }
function _nbBatterGames(player) {
  const name = _nbNormPlayer(player)
  if (!name) return null
  const now = Date.now()
  if (!_nbLogCache || now - _nbLogCacheAt > 5 * 60 * 1000) {
    try {
      const raw = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "data", "mlbBatterGameLogs.json"), "utf8"))
      _nbLogCache = (raw && raw.players) || raw || {}
    } catch (_) { _nbLogCache = {} }
    _nbLogCacheAt = now
  }
  const entry = _nbLogCache[name]
  if (!entry) return null
  return Array.isArray(entry.games) ? entry.games : (Array.isArray(entry) ? entry : null)
}

// 2026-06-08 SHIP 2 — stolen-bases kill-switch. Read ONCE at module load
// (CALIB_LINEAWARE / NBA_BUCKET_TIER_POLICY precedent). unset/"1" → ON; ONLY the
// exact string "0" → OFF. OFF ⇒ projectHitterStats emits NO stolenBases band
// (predictions object byte-identical to pre-SHIP-2 for every existing family).
// Mirrored by the same flag in buildMlbPropClusters.js (classifier/tier gates).
const SB_ENABLED = String(process.env.MLB_ENABLE_STOLEN_BASES ?? "1") !== "0"

function norm(v) {
  return String(v == null ? "" : v).trim()
}

/** Normalize sportsbook / feed lineup signals to 1–9, or null. */
function extractLineupSpotFromRow(r) {
  if (!r || typeof r !== "object") return null
  const keys = ["lineupPosition", "battingOrderIndex", "lineupSpot", "battingOrder", "battingOrderSpot"]
  const tryObj = (o) => {
    if (!o || typeof o !== "object") return null
    for (const k of keys) {
      const raw = Number(o[k])
      if (!Number.isFinite(raw) || raw <= 0) continue
      const n = raw > 20 ? Math.floor(raw / 100) : raw
      if (n >= 1 && n <= 9) return n
    }
    return null
  }
  const direct = tryObj(r)
  if (direct != null) return direct
  return tryObj(r.__src)
}

function lineupCandidatePriority(e) {
  const mk = String(e.marketKey || "").toLowerCase()
  const pt = String(e.propType || "").toLowerCase()
  if (mk === "batter_hits") return 100
  if (pt === "hits" && !mk.includes("first")) return 95
  if (mk.includes("total_bases") || pt.includes("total bases")) return 90
  if (mk.includes("batter_rbis") || pt.includes("rbi")) return 85
  if (mk.includes("batter_runs_scored") || (mk.includes("runs") && mk.includes("batter"))) return 82
  if (mk.includes("batter_") || pt.includes("home run")) return 55
  return 10
}

function pickPreferredLineupSpot(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null
  const sorted = [...candidates].sort((a, b) => lineupCandidatePriority(b) - lineupCandidatePriority(a))
  const top = sorted[0]
  return Number.isFinite(top?.spot) ? top.spot : null
}

/**
 * Build ONE shared player dataset for the slate.
 * Keyed by normalized player name (single source of truth).
 *
 * Each value is a mutable player object that downstream models
 * (Hits, RBI, etc.) should update IN PLACE.
 */
function buildMlbPlayerDataset(input = {}) {
  const rows = Array.isArray(input?.rows) ? input.rows : []
  const playerMap = new Map()

  for (const r of rows) {
    const raw = norm(r?.player)
    if (!raw) continue
    const key = normalizeName(raw)
    if (!key) continue
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        key,
        player: raw,
        team: r?.teamResolved ?? r?.team ?? null,
      })
    }
  }

  // Second pass: attach batting order from any row (prefer main batter markets over novelty).
  for (const r of rows) {
    const raw = norm(r?.player)
    if (!raw) continue
    const key = normalizeName(raw)
    if (!key || !playerMap.has(key)) continue
    const spot = extractLineupSpotFromRow(r)
    if (spot == null) continue
    const o = playerMap.get(key)
    if (!o._lineupCandidates) o._lineupCandidates = []
    o._lineupCandidates.push({
      spot,
      eventId: r?.eventId ?? null,
      marketKey: r?.marketKey ?? null,
      propType: r?.propType ?? null,
    })
  }

  for (const o of playerMap.values()) {
    const chosen = pickPreferredLineupSpot(o._lineupCandidates || [])
    delete o._lineupCandidates
    if (chosen != null) {
      o.battingOrderIndex = chosen
      o.lineupPosition = chosen
    }
  }

  return { playerMap }
}

// ---- Player outcome bands (floor / median / ceiling) — unified with dataset module ----
// ---- Stat families (consumed by buildMlbBestBetsBoard) ----
// 2026-06-08 SHIP 2 — "stolenBases" appended only when the kill-switch is ON, so
// OFF leaves this list (and every downstream family iteration) byte-identical.
const HITTER_STATS = SB_ENABLED
  ? ["hits", "totalBases", "hr", "rbis", "runs", "batterKs", "stolenBases"]
  : ["hits", "totalBases", "hr", "rbis", "runs", "batterKs"]
const PITCHER_STATS = ["ks", "outs", "hitsAllowed", "earnedRuns", "walks"]

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function clamp(lo, hi, x) {
  return Math.max(lo, Math.min(hi, x))
}

function clamp01(x) {
  if (!Number.isFinite(Number(x))) return 0
  return clamp(0, 1, Number(x))
}

function round1(x) {
  return Math.round(Number(x) * 10) / 10
}

function playerSalt(player, eventId) {
  const s = `${String(player || "").toLowerCase()}|${String(eventId || "")}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

// 2026-07-16 N1 — MEAN→MEDIAN center fix (POST_FREEZE_GRADUATION_PLAN §N1;
// de-vig audit 9276e13). eHits = P(≥1)+P(≥2)+P(≥3) is the MEAN of the count
// distribution, but it is labeled `hitsMedian` and used as the band CENTER
// (mostLikely) feeding modelProbForSide's logistic — and books price the
// MEDIAN. For these right-skewed count families the mean sits ABOVE the
// median, so a mean center systematically inflates over-side modelProb
// (over-bets the over). The corpus agrees on direction (family_calibration,
// 7d window read 2026-07-16): hits stated 13.8% vs realized 10.4% · runs
// 9.7/7.7 · rbis 6.1/4.3 — every ladder-scored batter family over-confident
// on the over side. ON ⇒ mostLikely = the true ladder median (smallest k with
// P(X ≤ k) ≥ 0.5, read from the survival rungs). floor/ceiling/ladder stay
// mean-derived and BYTE-IDENTICAL either way — ONLY the center moves, so the
// change is independently measurable (the plan's do-not-bundle rule).
// DEFAULT OFF (kill-switch like G1); the forward gate decides ON: the
// median-centered modelProb must beat the mean-centered one on reliability
// gap + Brier on forward data before it ships as default.
const N1_MEDIAN_ON = String(process.env.MLB_N1_MEDIAN ?? "0") === "1"
console.log(`[N1-MEDIAN-BOOT] MLB band center: ${N1_MEDIAN_ON ? "MEDIAN (MLB_N1_MEDIAN=1 — ladder-survival median feeds modelProbForSide)" : "mean (default — N1 OFF, pre-N1-identical)"}`)

/**
 * Median of a count distribution from its survival rungs [P(≥1), P(≥2), …]:
 * the count of leading rungs with p ≥ 0.5 (the walk stops at the first
 * p < 0.5 — robust to heuristic non-monotone tails). Examples:
 * [0.72, 0.38, 0.12] → 1 (mean would be 1.22); [0.42, …] → 0.
 */
function ladderMedian(survival) {
  let m = 0
  for (const p of Array.isArray(survival) ? survival : []) {
    if (Number(p) >= 0.5) m += 1
    else break
  }
  return m
}

/**
 * Build hitter projection bands using ladder probabilities + power profile.
 *
 *   E[hits]     = p(1+) + p(2+) + p(3+)
 *   E[TB]       = p(TB1+) + p(TB2+) + p(TB3+) + p(TB4+) + p(TB5+)?
 *   E[HR]       = hrProbability (clamped to ~[0, 0.6])
 *   E[RBIs]     = p(1+RBI) + p(2+RBI) + p(3+RBI)
 *   E[runs]     ~ heuristic from lineup position + team implied runs
 *   E[batterKs] ~ heuristic from opposing pitcher K-rate (defaults if unknown)
 *
 *  Floor = max(0, E - σ); Ceiling = E + 1.6σ. Sigma is family-specific.
 */
function projectHitterStats({ playerObj, hrProb, salt }) {
  const h1 = num(playerObj?.hit1plus) ?? 0
  const h2 = num(playerObj?.hit2plus) ?? 0
  const h3 = num(playerObj?.hit3plus) ?? 0
  const r1 = num(playerObj?.rbi1plus) ?? 0
  const r2 = num(playerObj?.rbi2plus) ?? 0
  const power = num(playerObj?.powerScore) ?? 8
  const powerNorm = clamp(0, 1, (power - 8) / 24)
  const bo = num(playerObj?.battingOrderIndex) ?? num(playerObj?.lineupPosition)
  const lineupTop = Number.isFinite(bo) ? bo : 6

  // Hits — band tightened so ceiling ~ median + 1 unless multi-hit prob is real.
  const eHits = h1 + h2 + h3
  const hitsMedian = round1(clamp(0, 4, eHits))
  const hitsFloor = Math.max(0, Math.round((hitsMedian - 0.7) * 10) / 10)
  const hitsCeiling = round1(clamp(1, 4, hitsMedian + 0.8 + (h3 > 0.18 ? 0.7 : 0) + (h2 > 0.45 ? 0.3 : 0)))
  const hitsLadder = { 0.5: h1, 1.5: h2, 2.5: h3 }
  // N1: ON ⇒ the band TRANSLATES RIGIDLY to the ladder-survival median —
  // center, floor and ceiling all shift by (median − mean) so band WIDTH is
  // preserved. This matters because the scorer derives sigma from
  // (ceiling − center) and (center − floor): moving the center alone would
  // inflate sigma and push sub-coin over-probs TOWARD 0.5 (measured on the
  // 07-16 probe: rbis logistic avgP rose 0.259→0.266 — the opposite of N1's
  // intent). Rigid translation keeps sigma identical, so the ONLY effect is
  // the center shift itself. OFF ⇒ shift = 0 ⇒ byte-identical legacy values.
  const hitsCenter = N1_MEDIAN_ON ? ladderMedian([h1, h2, h3]) : hitsMedian
  const hitsShift = hitsCenter - hitsMedian
  const hitsFloorN1 = Math.max(0, round1(hitsFloor + hitsShift))
  const hitsCeilingN1 = round1(clamp(1, 4, hitsCeiling + hitsShift))

  // Total bases.
  // Phase Signal-Fill-1A FIX 7b (park doublesFactor, 2026-06-06): the home park's doubles factor scales
  // the extra-base rungs (tb2 = 2+ TB, tb3 = 3+ TB), capped ±10% like the hits factor. Trap 1 guard:
  // num(null)=0, so apply only when doublesFactor is finite AND > 0 (uncached/unknown park -> dfMul=1,
  // baseline). tb4 (4+ TB) is HR-driven, left unscaled. doublesFactor set on the obj by the hits engine.
  const dfRaw = num(playerObj?.doublesFactor)
  const dfMul = (Number.isFinite(dfRaw) && dfRaw > 0) ? clamp(0.90, 1.10, dfRaw) : 1
  const tb2 = clamp01((h2 * 0.62 + hrProb * 0.25 + h1 * 0.13 + powerNorm * 0.05) * dfMul)
  const tb3 = clamp01((h2 * 0.45 + hrProb * 0.35 + h3 * 0.2 + powerNorm * 0.06) * dfMul)
  const tb4 = clamp01(hrProb * 0.58 + h2 * 0.22 + h3 * 0.1 + powerNorm * 0.1)
  const eTB = h1 + tb2 + tb3 + tb4
  const tbMedian = round1(clamp(0, 8, eTB))
  const tbFloor = Math.max(0, round1(tbMedian - 0.9))
  const tbCeiling = round1(clamp(2, 9, tbMedian + 1.4 + powerNorm * 1.0))
  const tbLadder = { 0.5: h1, 1.5: tb2, 2.5: tb3, 3.5: tb4 }
  const tbCenter = N1_MEDIAN_ON ? ladderMedian([h1, tb2, tb3, tb4]) : tbMedian // N1 (rigid translate — see hits)
  const tbShift = tbCenter - tbMedian
  const tbFloorN1 = Math.max(0, round1(tbFloor + tbShift))
  const tbCeilingN1 = round1(clamp(2, 9, tbCeiling + tbShift))

  // HR — direct probability is the single source of truth.
  const hrMedian = 0
  const hrFloor = 0
  const hrCeiling = hrProb >= 0.2 ? 1 : 0
  const hrLadder = {
    0.5: hrProb,
    1.5: Math.max(0.001, hrProb * hrProb),
    2.5: Math.max(0.0005, Math.pow(hrProb, 3)),
  }

  // RBIs — tighter ceiling: only widen when 2+RBI prob has real signal.
  const eRbi = r1 + r2 * 1.4
  const rbiMedian = round1(clamp(0, 4, eRbi))
  const rbiFloor = 0
  const rbiCeiling = round1(clamp(1, 4, rbiMedian + 0.9 + (r2 > 0.20 ? 0.6 : 0)))
  const rbiLadder = { 0.5: r1, 1.5: r2 }
  const rbiCenter = N1_MEDIAN_ON ? ladderMedian([r1, r2]) : rbiMedian // N1 (rigid translate — see hits)
  const rbiShift = rbiCenter - rbiMedian
  const rbiFloorN1 = Math.max(0, round1(rbiFloor + rbiShift))
  const rbiCeilingN1 = round1(clamp(1, 4, rbiCeiling + rbiShift))

  // Runs — direct Bernoulli prior for P(≥1 run). MLB league average is ~0.30
  // for a regular hitter, scaled by team total + lineup spot.
  const teamRunsImplied = num(playerObj?.teamImpliedTotal) ?? 4.4
  const lineupBoost =
    lineupTop <= 2 ? 0.07 : lineupTop <= 4 ? 0.04 : lineupTop <= 6 ? 0.0 : -0.04
  // Phase Signal-Fill-1A FIX 5 (runs OBP, 2026-06-06): fold the batter's OWN on-base rate into
  // P(>=1 run), centered at league-avg .320, weight 0.5. GUARD (Trap 1: num(null)=0): apply only when
  // obp is finite AND > 0 — an uncached batter (obp null → num=0) gets NO term, NOT a -0.16 penalty.
  // The existing clamp(0.15,0.55) bounds extremes; no extra clamp needed. (OBP mildly correlates with
  // lineupBoost — leadoff hitters run high OBP — but they're distinct signals; dampener tunes.)
  const obp = num(playerObj?.obp)
  const obpTerm = (Number.isFinite(obp) && obp > 0) ? (obp - 0.32) * 0.5 : 0
  const p1run = clamp(0.15, 0.55, 0.3 + (teamRunsImplied - 4.4) * 0.04 + lineupBoost + obpTerm)
  const eRuns = p1run + p1run * p1run * 0.4
  const runsMedian = round1(eRuns)
  const runsFloor = 0
  const runsCeiling = round1(clamp(1, 3, runsMedian + 0.7))
  const runsLadder = { 0.5: p1run, 1.5: Math.max(0.04, p1run * p1run * 0.6) }
  const runsCenter = N1_MEDIAN_ON ? ladderMedian([p1run, Math.max(0.04, p1run * p1run * 0.6)]) : runsMedian // N1 (rigid translate — see hits)
  const runsShift = runsCenter - runsMedian
  const runsFloorN1 = Math.max(0, round1(runsFloor + runsShift))
  const runsCeilingN1 = round1(clamp(1, 3, runsCeiling + runsShift))

  // Batter Ks — opposing pitcher K rate scaled by typical 4.2 PA.
  // Phase Signal-Fill-1B FIX 3 (2026-06-06): prefer the OPPOSING pitcher's REAL per-PA kRate
  // (set on playerObj.opposingPitcherKRate by buildMlbHitsProbabilityEngine from
  // pitcherEnvironmentContext.kRate). eKs = kRate × ~4.2 PA — dimensionally correct (per-PA × PA),
  // NOT the prior k9-detour. (The earlier ×9 idea was a unit error: kRate is per-PA, not per-9.)
  // Trap 1: num(absent)→null and the `> 0` check route an uncached batter to the OLD formula below
  // (flat ~2.0), never 0. The OLD k9/8.5-constant path is preserved as the fallback so behavior is
  // unchanged when the opposing pitcher isn't resolved. Model-anchored → Trap 5 clean.
  const oppKRate = num(playerObj?.opposingPitcherKRate)
  const eBatterKs = (Number.isFinite(oppKRate) && oppKRate > 0)
    ? clamp(0.4, 2.0, oppKRate * 4.2)
    : clamp(0.4, 2.0, ((num(playerObj?.opposingPitcherKper9) ?? num(playerObj?.opposingKsPer9) ?? 8.5) / 9) * 4.2)
  const saltedBatterKs = eBatterKs * (1 + (salt - 0.5) * 0.18)
  const batterKsMedian = round1(saltedBatterKs)
  const batterKsFloor = 0
  const batterKsCeiling = round1(clamp(1, 4, batterKsMedian + 1.0))

  // 2026-06-08 SHIP 2 — stolenBases Poisson band (gated). λ = seasonSB / gamesPlayed
  // from the season stats cache (plumbed onto batterStats by applyMlbContextualLayers).
  // P(SB≥k) is Poisson — k=1 for the standard 0.5 line. Honesty (probabilityHonesty
  // spirit): missing/non-finite rate OR gamesPlayed ⇒ NO band emitted (key omitted) ⇒
  // modelProbOver returns null ⇒ no pick — never a fabricated rate. Zero-SB batter ⇒
  // λ=0 ⇒ P=0 ⇒ no edge ⇒ FADE. The ladder carries the real probability; modelProbForSide
  // has a dedicated NO-SHRINK bypass for this family so the rate signal isn't flattened.
  let stolenBasesBand = null
  if (SB_ENABLED) {
    // Trap-1 guard: read the RAW value (NOT num(), which coerces null→0). A MISSING
    // rate (null/undefined) must give NO band — never a fabricated "0 steals". A real
    // 0-SB batter DOES get a band (λ=0 → P≈0 → no edge → FADE), which is honest.
    // Number.isFinite(null/undefined)===false; Number.isFinite(0)===true.
    const sbSeason = playerObj?.batterStats?.stolenBases ?? playerObj?.stolenBases
    const gp = playerObj?.batterStats?.gamesPlayed ?? playerObj?.gamesPlayed
    if (Number.isFinite(sbSeason) && sbSeason >= 0 && Number.isFinite(gp) && gp > 0) {
      const lambda = sbSeason / gp
      const pSb1 = 1 - Math.exp(-lambda)                  // P(SB ≥ 1) per game
      const pSb2 = clamp01(1 - Math.exp(-lambda) * (1 + lambda)) // P(SB ≥ 2)
      stolenBasesBand = {
        floor: 0,
        mostLikely: round1(lambda),
        ceiling: pSb1 >= 0.5 ? 2 : (pSb1 >= 0.12 ? 1 : 0),
        lambda: round1(lambda),
        ladder: { 0.5: clamp01(pSb1), 1.5: pSb2 },
      }
    }
  }

  // 2026-06-12 T2-L1 (mlb-nb-ladder-v1) — fitted NegBinom SHADOW ladder for
  // totalBases, from the batter's REAL game log (21d window, n≥10 floor per
  // playerPropHistory MIN_GAMES). The heuristic `ladder` above is UNTOUCHED and
  // remains the only scoring input (R2 freeze). `__nbGamesOverride` lets the
  // fixture inject deterministic logs without fs. Thin/missing ⇒ no key.
  let _tbNB = null
  if (NB_LADDER_ON) {
    try {
      const games = playerObj?.__nbGamesOverride || _nbBatterGames(playerObj?.player)
      if (games) _tbNB = _nbLadderFromLogs(games, "totalBases")
    } catch (_) { _tbNB = null }
  }

  return {
    hits: { floor: hitsFloorN1, mostLikely: hitsCenter, ceiling: hitsCeilingN1, ladder: hitsLadder },
    totalBases: {
      floor: tbFloorN1, mostLikely: tbCenter, ceiling: tbCeilingN1, ladder: tbLadder,
      // T2-L1 shadow field — present IFF switch ON and fit succeeded (n≥10).
      ...(_tbNB ? { ladderNB: _tbNB.ladder, ladderNBMeta: _tbNB.meta } : {}),
    },
    hr: { floor: hrFloor, mostLikely: hrMedian, ceiling: hrCeiling, hrProb, ladder: hrLadder },
    rbis: { floor: rbiFloorN1, mostLikely: rbiCenter, ceiling: rbiCeilingN1, ladder: rbiLadder },
    runs: { floor: runsFloorN1, mostLikely: runsCenter, ceiling: runsCeilingN1, ladder: runsLadder },
    batterKs: { floor: batterKsFloor, mostLikely: batterKsMedian, ceiling: batterKsCeiling },
    ...(stolenBasesBand ? { stolenBases: stolenBasesBand } : {}),
  }
}

function projectPitcherStats({ pitcherObj, salt }) {
  const expectedKs = num(pitcherObj?.expectedKs)
  const ksLine = num(pitcherObj?.line)
  const k5 = num(pitcherObj?.k5plus) ?? 0
  const k6 = num(pitcherObj?.k6plus) ?? 0
  const k7 = num(pitcherObj?.k7plus) ?? 0
  const k8 = num(pitcherObj?.k8plus) ?? 0

  // E[Ks] — prefer engine's expectedKs; otherwise derive from ladder.
  let eKs = Number.isFinite(expectedKs) ? expectedKs : null
  if (!Number.isFinite(eKs)) {
    // Approximate E[Ks] via ladder probabilities.
    const ladderSum = k5 + k6 + k7 + k8
    eKs = clamp(2.5, 11, 4 + ladderSum * 1.4)
  }
  // Salt nudge ±5%.
  eKs *= 1 + (salt - 0.5) * 0.1
  const ksMedian = round1(clamp(2.5, 12, eKs))
  const ksFloor = round1(clamp(0, 12, ksMedian - 2.4))
  const ksCeiling = round1(clamp(3, 14, ksMedian + 3.0))

  // Outs — Phase Signal-Fill-1A FIX 2 (2026-06-06): use real expected innings/start (set on the
  // topPitchers entry as ipExpected = clamped IP/GS) → outs = ipExpected*3, instead of the flat 17.
  // GUARD `> 0`: num(null)=0 (Number(null)=0) and `0 ?? x` does NOT fall back, so an uncached pitcher
  // (ipExpected null on the entry) would otherwise yield 0*3=0 outs. `> 0` keeps the honest 17 fallback
  // for uncached/0 while using real IP/GS for cached pitchers.
  const ipExpected = num(pitcherObj?.ipExpected) ?? num(pitcherObj?.expectedInnings) ?? null
  const outsMedian = (Number.isFinite(ipExpected) && ipExpected > 0) ? round1(ipExpected * 3) : 17
  const outsFloor = round1(clamp(0, 27, outsMedian - 5))
  const outsCeiling = round1(clamp(6, 27, outsMedian + 4))

  // Hits allowed — derive from K rate (high K → fewer hits).
  const hitsAllowedMedian = clamp(2, 8, 5.4 - (eKs - 6) * 0.18)
  const hitsAllowedFloor = round1(Math.max(0, hitsAllowedMedian - 2.0))
  const hitsAllowedCeiling = round1(clamp(3, 12, hitsAllowedMedian + 3.0))

  // Earned runs — slight inverse to K rate.
  const erMedian = round1(clamp(0.6, 4.5, 2.5 - (eKs - 6) * 0.12))
  const erFloor = 0
  const erCeiling = round1(clamp(1, 7, erMedian + 2.5))

  // Walks — Phase Signal-Fill-1A (2026-06-06): bbRate-driven instead of name-hash.
  // BEFORE: walksMedian = 1.8 + (salt-0.5)*1.0 → ~1.8 for every pitcher regardless of control
  // (name-hash jitter only). NOW: pitcher's own walk rate × expected batters faced. EXPECTED_BF
  // is a ~24 BF/start constant until FIX 2 (outs) lands real ipExpected (then derive BF from it).
  // bbRate comes from the topPitchers entry pass-through (buildMlbPitcherKsProbabilityEngine).
  const EXPECTED_BF = 24
  const bbRate = num(pitcherObj?.bbRate)
  const walksMedian = Number.isFinite(bbRate)
    ? round1(clamp(0.5, 4, bbRate * EXPECTED_BF))
    : round1(clamp(0.5, 4, 1.8 + (salt - 0.5) * 1.0))   // fallback when bbRate not cached
  const walksFloor = 0
  const walksCeiling = round1(clamp(1, 6, walksMedian + 2.0))

  // Pre-calibrated ladder probs from the pitcher Ks engine.
  const ksLadder = { 4.5: k5, 5.5: k6, 6.5: k7, 7.5: k8 }

  return {
    ks: {
      floor: ksFloor,
      mostLikely: ksMedian,
      ceiling: ksCeiling,
      line: ksLine ?? null,
      ladder: ksLadder,
    },
    outs: { floor: outsFloor, mostLikely: round1(outsMedian), ceiling: outsCeiling },
    hitsAllowed: {
      floor: hitsAllowedFloor,
      mostLikely: round1(hitsAllowedMedian),
      ceiling: hitsAllowedCeiling,
    },
    earnedRuns: { floor: erFloor, mostLikely: erMedian, ceiling: erCeiling },
    walks: { floor: walksFloor, mostLikely: walksMedian, ceiling: walksCeiling },
  }
}

/**
 * Merge HR lists into one entry per normalized player: keep the candidate with
 * highest modelProbability (tie-break: higher hrScore). Avoids diverse-list
 * ordering overwriting a stronger mostLikelyHr row.
 */
function mergeHrSourceIndex(hrSrc) {
  const hrIdx = new Map()
  for (const p of hrSrc) {
    const k = normalizeName(p?.player)
    if (!k) continue
    const pr = num(p?.modelProbability)
    const prob = Number.isFinite(pr) ? pr : 0
    const ed = num(p?.edge)
    const edge = Number.isFinite(ed) ? ed : 0
    const hrSc = num(p?.hrScore)
    const hy = num(p?.hybridScore)
    const tag = typeof p?.tag === "string" ? p.tag : null
    const implied = num(p?.impliedProbability)
    const displayPlayer = String(p?.player || "").trim() || null
    const cand = {
      player: displayPlayer,
      prob,
      edge,
      tag,
      hybridScore: Number.isFinite(hy) ? hy : null,
      hrScore: Number.isFinite(hrSc) ? hrSc : null,
      impliedProbability: Number.isFinite(implied) ? implied : null,
    }
    const prev = hrIdx.get(k)
    if (!prev) {
      hrIdx.set(k, cand)
      continue
    }
    const betterProb = prob > prev.prob + 1e-12
    const tieProb = Math.abs(prob - prev.prob) <= 1e-12
    const hrNew = Number.isFinite(hrSc) ? hrSc : -Infinity
    const hrOld = Number.isFinite(prev.hrScore) ? prev.hrScore : -Infinity
    if (betterProb || (tieProb && hrNew > hrOld)) hrIdx.set(k, cand)
  }
  return hrIdx
}

function hrConfidenceNumeric(tag, fallbackProb) {
  const t = String(tag || "").toUpperCase()
  if (t === "ELITE") return 0.82
  if (t === "STRONG") return 0.66
  if (t === "LOTTO") return 0.36
  const fp = num(fallbackProb)
  if (!Number.isFinite(fp) || fp <= 0) return null
  return Math.max(0.12, Math.min(0.88, fp * 2.4))
}

function buildMlbPlayerOutcomePredictions(input = {}) {
  const generatedAt = new Date().toISOString()
  const playerMap = input?.playerMap instanceof Map ? input.playerMap : null
  const hrPredictionToday = input?.hrPredictionToday || {}
  const pitcherKsToday = input?.pitcherKsToday || {}
  const rows = Array.isArray(input?.rows) ? input.rows : []

  // Build a HR probability index for fast lookup.
  const hrSrc = []
  if (Array.isArray(hrPredictionToday?.topHrCandidatesToday)) hrSrc.push(...hrPredictionToday.topHrCandidatesToday)
  if (Array.isArray(hrPredictionToday?.mostLikelyHr)) hrSrc.push(...hrPredictionToday.mostLikelyHr)
  const hrIdx = mergeHrSourceIndex(hrSrc)

  // Build a meta lookup from snapshot rows for matchup/eventId fallback.
  const metaIdx = new Map()
  for (const r of rows) {
    const k = normalizeName(r?.player)
    if (!k || metaIdx.has(k)) continue
    metaIdx.set(k, {
      eventId: r?.eventId ?? null,
      matchup: r?.matchup ?? null,
      team: r?.teamResolved ?? r?.team ?? null,
      teamCode: r?.teamCode ?? null,
      awayTeam: r?.awayTeam ?? null,
      homeTeam: r?.homeTeam ?? null,
      opponent: r?.opponentTeam ?? null,
      isHome: r?.isHome ?? null,
    })
  }

  // -------- Hitters --------
  const hitters = []
  if (playerMap) {
    for (const obj of playerMap.values()) {
      const player = String(obj?.player || "").trim()
      if (!player) continue
      const k = normalizeName(player)
      const meta = metaIdx.get(k) || {}
      const eventId = obj?.eventId ?? meta.eventId ?? null
      const matchup = obj?.matchup ?? meta.matchup ?? null
      const team = obj?.team ?? meta.team ?? null
      const teamCode = obj?.teamCode ?? meta.teamCode ?? null
      const awayTeam = obj?.awayTeam ?? meta.awayTeam ?? null
      const homeTeam = obj?.homeTeam ?? meta.homeTeam ?? null
      const opponent = obj?.opponent ?? obj?.opponentTeam ?? meta.opponent ?? null
      const hrInfo = hrIdx.get(k) || {
        prob: 0,
        edge: 0,
        tag: null,
        hybridScore: null,
        hrScore: null,
        impliedProbability: null,
      }
      const salt = playerSalt(player, eventId)

      // Shared playerMap: keep HR engine outputs aligned with outcome projections (single path).
      obj.hrModelProbability = hrInfo.prob
      obj.hrEdge = hrInfo.edge
      obj.hrConfidenceTag = hrInfo.tag
      obj.hrHybridScore = hrInfo.hybridScore
      obj.hrScoreFromEngine = hrInfo.hrScore

      const stats = projectHitterStats({ playerObj: obj, hrProb: hrInfo.prob, salt })
      const hrConf = hrConfidenceNumeric(hrInfo.tag, hrInfo.prob)
      const hyNum = num(hrInfo.hybridScore)
      const hrEv = Number.isFinite(hyNum)
        ? hyNum
        : Number.isFinite(hrInfo.edge) && hrInfo.prob > 0
          ? hrInfo.edge
          : null

      hitters.push({
        player,
        eventId,
        matchup,
        team,
        teamCode,
        awayTeam,
        homeTeam,
        opponent,
        role: "hitter",
        battingOrder: num(obj?.battingOrderIndex) ?? num(obj?.lineupPosition) ?? null,
        stats,
        hrProb: hrInfo.prob,
        hrProbability: hrInfo.prob,
        hrEdge: hrInfo.edge,
        hrConfidence: hrConf,
        hrExpectedValue: hrEv,
        powerScore: num(obj?.powerScore) ?? null,
      })
    }
  }

  // -------- Pitchers --------
  const pitchers = []
  const pitcherSrc = Array.isArray(pitcherKsToday?.topPitchers) ? pitcherKsToday.topPitchers : []
  for (const p of pitcherSrc) {
    const player = String(p?.player || "").trim()
    if (!player) continue
    const k = normalizeName(player)
    const meta = metaIdx.get(k) || {}
    const eventId = p?.eventId ?? meta.eventId ?? null
    const matchup = meta.matchup ?? null
    const salt = playerSalt(player, eventId)
    const stats = projectPitcherStats({ pitcherObj: p, salt })
    pitchers.push({
      player,
      eventId,
      matchup,
      team: p?.team ?? meta.team ?? null,
      teamCode: p?.teamCode ?? meta.teamCode ?? null,
      awayTeam: p?.awayTeam ?? meta.awayTeam ?? null,
      homeTeam: p?.homeTeam ?? meta.homeTeam ?? null,
      opponent: p?.opponent ?? meta.opponent ?? null,
      role: "pitcher",
      stats,
      expectedKs: num(p?.expectedKs) ?? null,
      ksLine: num(p?.line) ?? null,
    })
  }

  return {
    engine: "mlb-player-outcome-predictions",
    generatedAt,
    hitters,
    pitchers,
    players: [...hitters, ...pitchers],
    meta: {
      hitterCount: hitters.length,
      pitcherCount: pitchers.length,
      hrIndexed: hrIdx.size,
      hitterStats: HITTER_STATS,
      pitcherStats: PITCHER_STATS,
    },
  }
}

module.exports = {
  buildMlbPlayerDataset,
  buildMlbPlayerOutcomePredictions,
  mergeHrSourceIndex,
  HITTER_STATS,
  PITCHER_STATS,
  projectHitterStats, // 2026-06-08 SHIP 2 — exported for the regression probe (pure fn; no behavior change)
  ladderMedian, // 2026-07-16 N1 — exported for verifyN1MedianCenter (pure fn)
  N1_MEDIAN_ON, // 2026-07-16 N1 — switch state, for probes/fixtures
}
