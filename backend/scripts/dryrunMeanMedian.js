#!/usr/bin/env node
// READ-ONLY dry-run (N1 mean→median): proves the band-center bias on REAL player data.
// buildMlbPlayerDataset.js sets the totalBases band center to round1(eTB) where eTB = Σ P(X≥k)
// = the NB MEAN (:221-222), labelled "median"/mostLikely. The true median = smallest k with
// P(X≤k) >= 0.5. For right-skewed count props the mean sits ABOVE the median → the center is
// inflated → modelProbForSide over-states the OVER. Reads the SAME NB fit the engine uses
// (negBinomLadder fitCountsMoM/survival) on the REAL totalBases game logs. No live path touched.
//   node backend/scripts/dryrunMeanMedian.js
const fs = require("fs"), path = require("path")
const { fitCountsMoM, survival } = require("../pipeline/mlb/negBinomLadder")

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "mlbBatterGameLogs.json"), "utf8"))
const players = raw.players || raw
const round1 = (x) => Math.round(x * 10) / 10
const clamp = (lo, hi, x) => Math.max(lo, Math.min(hi, x))

let n = 0, biasUp = 0, equal = 0, biasDown = 0, sumGap = 0
const examples = []
for (const [name, entry] of Object.entries(players)) {
  const games = Array.isArray(entry.games) ? entry.games : (Array.isArray(entry) ? entry : null)
  if (!games) continue
  const counts = games.map(g => Number(g && g.stats ? g.stats.totalBases : NaN)).filter(x => Number.isFinite(x) && x >= 0)
  const fit = fitCountsMoM(counts)
  if (!fit) continue
  n++
  let eTB = 0; for (let k = 1; k <= 8; k++) eTB += survival(fit, k)   // = the MEAN, truncated like the engine
  const currentCenter = round1(clamp(0, 8, eTB))                       // = tbMedian/mostLikely today
  let median = 0; for (let k = 0; k <= 8; k++) { if (1 - survival(fit, k + 1) >= 0.5) { median = k; break } }
  const gap = Math.round((currentCenter - median) * 100) / 100
  sumGap += gap
  if (gap > 0) biasUp++; else if (gap === 0) equal++; else biasDown++
  if (examples.length < 8 && gap > 0) examples.push({ name, n: fit.n, mean: round1(fit.mean), currentCenter, median, gap })
}

console.log("=== DRY-RUN N1: mean→median band-center bias (totalBases, REAL game logs) ===")
console.log(`players fit: ${n}`)
console.log(`current center (mean) ABOVE true median : ${biasUp}  (${(biasUp / n * 100).toFixed(1)}%)  <- over-bets the OVER`)
console.log(`current center == true median           : ${equal}  (${(equal / n * 100).toFixed(1)}%)`)
console.log(`current center BELOW true median        : ${biasDown}  (${(biasDown / n * 100).toFixed(1)}%)`)
console.log(`mean center - median, averaged          : +${(sumGap / n).toFixed(3)} TB`)
console.log("\nExamples (current mean-center vs true median):")
for (const e of examples) console.log(`  ${e.name.padEnd(22)} n=${String(e.n).padStart(2)} fitMean=${e.mean} currentCenter=${e.currentCenter} trueMedian=${e.median}  (over-states by ${e.gap})`)
console.log("\nFIX (post-freeze, behind default-OFF MLB_MEDIAN_CENTER): set the TB band center to the true")
console.log("median → modelProbForSide OVER probs drop on the biased rungs. NB ladder = totalBases only;")
console.log("hits/rbis/runs need NB ladders first (composes with extending G2). READ-ONLY; live path untouched.")
