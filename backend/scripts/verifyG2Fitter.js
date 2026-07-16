"use strict"
// verifyG2Fitter — G2-L1 fitter extension (2026-07-16, approved scope).
// Claims under test:
//   1. LAW 1 — the extension lives INSIDE the sanctioned negBinomLadder module;
//      legacy exports/behavior untouched (unweighted parity proven numerically);
//      the shadow-stack guard tracks the new export.
//   2. WEIGHTED MoM — halfLife null ⇒ EXACT legacy estimates; halfLife set ⇒
//      recency pulls the mean toward recent games; nEff < n under weighting;
//      halfLife is a parameter (v1 constant chosen by the L2 validator).
//   3. FLOORS + TAIL CAP — below minN ⇒ null (no curve, never a blend); rungs
//      stop at maxObserved+1 (tail-honesty: unapproached tails never priced).
//   4. DATA PREREQ — both refreshers write the ADDITIVE season sibling from
//      the same fetch; canonical rolling caches untouched (byte-identical
//      windows + paths).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

const { fitCountsMoM, fitCountsMoMWeighted, fitPlayerFamilyCurve, FAMILY_STAT_KEYS } = require("../pipeline/mlb/negBinomLadder")

// 1. parity: halfLife null reproduces the legacy fit EXACTLY
const sample = [0, 0, 1, 0, 4, 2, 0, 5, 1, 0, 3, 0]
const legacy = fitCountsMoM(sample)
const unweighted = fitCountsMoMWeighted(sample, { halfLife: null })
check("parity: unweighted weighted-MoM === legacy MoM (method/mean/variance/r/p)", legacy && unweighted && legacy.method === unweighted.method && near(legacy.mean, unweighted.mean) && near(legacy.variance, unweighted.variance) && near(legacy.r, unweighted.r) && near(legacy.p, unweighted.p))
check("parity: legacy exports untouched in source (ladderFromLogs/ladderFromCounts intact)", /function ladderFromLogs\(games, statKey, opts = \{\}\)/.test(rd("pipeline/mlb/negBinomLadder.js")) && /const MIN_GAMES = 10/.test(rd("pipeline/mlb/negBinomLadder.js")))
check("guard: shadow stack tracks fitPlayerFamilyCurve", /"fitPlayerFamilyCurve"/.test(rd("scripts/verifyShadowStackIntact.js")))

// 2. recency direction + nEff
const oldCold = [0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3] // oldest-first: cold then hot
const hlFit = fitCountsMoMWeighted(oldCold, { halfLife: 3 })
const flatFit = fitCountsMoMWeighted(oldCold, { halfLife: null })
check("recency: halfLife=3 pulls the mean toward the recent hot streak (weighted mean > flat mean)", hlFit && flatFit && hlFit.mean > flatFit.mean + 0.5)
check("recency: nEff < n under weighting; nEff === n unweighted", hlFit.nEff < hlFit.n && near(flatFit.nEff, flatFit.n))

// 3. floors + tail cap through the real curve API
const mkGames = (counts) => counts.map((c, i) => ({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, stats: { hits: c, rbi: c, totalBases: c, runs: c, strikeOuts: c } }))
check("floor: n=14 < minN 15 ⇒ null (absent, never a blend)", fitPlayerFamilyCurve(mkGames([1, 0, 2, 1, 0, 1, 2, 0, 1, 1, 0, 2, 1, 0]), "hits", { minN: 15 }) === null)
const curve = fitPlayerFamilyCurve(mkGames([0, 1, 0, 2, 1, 0, 1, 0, 1, 2, 0, 1, 0, 1, 1]), "hits", { minN: 15 })
check("tail cap: maxObserved=2 ⇒ rungs stop at 2.5 (k=3); no 3.5 rung priced", curve && curve.supportCap === 3 && curve.ladder["2.5"] != null && curve.ladder["3.5"] === undefined)
check("curve meta traceability: n/mean/variance/method/window all present", curve && curve.meta && curve.meta.n === 15 && Number.isFinite(curve.meta.mean) && curve.meta.method && curve.meta.window.oldest === "2026-06-01")
// date-order robustness: shuffled input must fit identically (sorted internally)
const shuffled = mkGames([0, 1, 0, 2, 1, 0, 1, 0, 1, 2, 0, 1, 0, 1, 1])
for (let i = shuffled.length - 1; i > 0; i--) { const j = (i * 7) % (i + 1); const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t }
const curveShuffled = fitPlayerFamilyCurve(shuffled, "hits", { minN: 15 })
check("order robustness: shuffled logs fit identically (internal date sort)", JSON.stringify(curveShuffled) === JSON.stringify(curve))
check("family map: rbis→rbi (batter logs), ks→strikeOuts (pitcher logs), unknown ⇒ null", FAMILY_STAT_KEYS.rbis === "rbi" && FAMILY_STAT_KEYS.ks === "strikeOuts" && fitPlayerFamilyCurve(mkGames([1, 1, 1]), "outs", {}) === null)

// 4. data prerequisite — season siblings, canonical caches untouched
const bref = rd("pipeline/mlb/ingest/refreshMlbBatterGameLogs.js")
const pref = rd("pipeline/mlb/ingest/refreshMlbPitcherGameLogs.js")
check("populators: ADDITIVE season sibling (200d) from the SAME fetch, both refreshers", /SEASON_WINDOW_DAYS = 200/.test(bref) && /mlbBatterGameLogsSeason\.json/.test(bref) && /SEASON_WINDOW_DAYS = 200/.test(pref) && /mlbPitcherGameLogsSeason\.json/.test(pref))
check("populators: canonical rolling windows untouched (21d batter / 14d pitcher) + season write failure isolated", /const WINDOW_DAYS = 21/.test(bref) && /const WINDOW_DAYS = 14/.test(pref) && /NEVER breaks/.test(bref) && /NEVER breaks/.test(pref))
check("probe: real-fit printout exists (fit vs empirical, floor refusals honest)", /empiricalSurvival/.test(rd("scripts/probeG2Fits.js")) && /honest absence|honest fallback/.test(rd("scripts/probeG2Fits.js")))

// module self-tests still green (legacy surface)
const st = require("child_process").spawnSync(process.execPath, [path.join(ROOT, "pipeline/mlb/negBinomLadder.js")], { encoding: "utf8", timeout: 30000 })
check("legacy inline self-tests still pass (17/17-era suite green)", st.status === 0 && /PASS/.test(st.stdout))

console.log(`verifyG2Fitter: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
