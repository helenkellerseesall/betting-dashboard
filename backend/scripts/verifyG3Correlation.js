"use strict"
// verifyG3Correlation — G3-L2 class fit + validation (2026-07-21, approved scope).
// Claims:
//   1. LAW 1 — the --g3 mode EXTENDS the sanctioned derive script; without the
//      flag the legacy path is untouched; the live shadow priors file is NEVER
//      written by a --g3 run (engine re-point = later gated step).
//   2. WALK-FORWARD — chronological slate split (2/3 train, held-out test),
//      canonical fitRhoZ on train pooled stats, per-pair test marginals with
//      the documented hierarchy (served mp else train-class empirical).
//   3. BARS — named verbatim (n≥500 · gap ≤2pp · copula Brier ≤ independence ·
//      cross-game |ρ|<0.05 = CERTIFIED_INDEPENDENT, proven never assumed);
//      era slice reported.
//   4. E2E — synthetic corpus with KNOWN structure: positive class recovers
//      ρ>0, independent cross_game certifies, drifted class STOPs on the gap
//      bar; verdicts JSON + report written.
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const src = fs.readFileSync(path.join(ROOT, "scripts", "deriveMlbCorrelationPriors.js"), "utf8")

check("Law 1: --g3 extension in the sanctioned file; legacy path preserved; priors file untouched in --g3 (exit before legacy write)", /const G3 = process\.argv\.includes\("--g3"\)/.test(src) && /mlbCorrelationPriors\.json \(the live shadow input\) is UNCHANGED/.test(src) && /process\.exit\(0\)\n}\n\nconst \{ files, games, settled \} = load\(\)/.test(src))
check("walk-forward: chronological 2/3 slate split, no lookahead; canonical fitRhoZ on train pool", /slates\.length \* 2 \/ 3/.test(src) && /trainSlates\.has\(r\.slate\)/.test(src) && /fitRhoZ\(px, py, pb\)/.test(src))
check("marginal hierarchy: served mp in (0,1) else train-class empirical; coverage reported", /r\.a\.mp > 0 && r\.a\.mp < 1/.test(src) && /t\.pa \?\? train\.px/.test(src) && /mpCoveragePct/.test(src))
check("bars verbatim: n≥500 · gap ≤2pp · Brier · cross-game |ρ|<0.05 certification", /minTestN: 500/.test(src) && /jointGapPp: 2\.0/.test(src) && /indepRhoAbs: 0\.05/.test(src) && /CERTIFIED_INDEPENDENT/.test(src))
check("bars: Brier comparison correctly EXCLUDED for cross_game (degenerate at ρ≈0 — copula ≡ product)", /DEGENERATE/.test(src) && /c === "cross_game" \? \{ indep/.test(src))
check("era slice: pre/post flip ρ re-fit reported (stability, not filter)", /preRho/.test(src) && /postRho/.test(src) && /deltaRho/.test(src))

// ── synthetic e2e ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g3corr-"))
const lcg = (s) => () => (s = (s * 48271) % 2147483647) / 2147483647
const rand = lcg(7)
const lines = []
// 40 synthetic slates; class "pos": P(A)=P(B)=0.5, strongly correlated (both follow the same latent coin 80% of the time)
// class "cross_game": independent coins. class "drift": train-era correlated, test-era anti-correlated ⇒ gap STOP.
for (let s = 0; s < 40; s++) {
  const slate = `2026-06-${String((s % 28) + 1).padStart(2, "0")}`
  const isTest = s >= 27
  for (let i = 0; i < 60; i++) {
    const latent = rand() < 0.5 ? 1 : 0
    const a1 = rand() < 0.8 ? latent : 1 - latent
    const b1 = rand() < 0.8 ? latent : 1 - latent
    lines.push(JSON.stringify({ slate, cls: "batter_batter_same_team", a: { p: "A", f: "hits", s: "over", l: 0.5, mp: 0.5, w: a1 }, b: { p: "B", f: "hits", s: "over", l: 0.5, mp: 0.5, w: b1 }, ev: "e1" }))
    const a2 = rand() < 0.5 ? 1 : 0, b2 = rand() < 0.5 ? 1 : 0
    lines.push(JSON.stringify({ slate, cls: "cross_game", a: { p: "C", f: "hits", s: "over", l: 0.5, mp: 0.5, w: a2 }, b: { p: "D", f: "hits", s: "over", l: 0.5, mp: 0.5, w: b2 }, ev: null }))
    const lat3 = rand() < 0.5 ? 1 : 0
    const a3 = rand() < 0.8 ? lat3 : 1 - lat3
    const b3 = isTest ? (rand() < 0.8 ? 1 - lat3 : lat3) : (rand() < 0.8 ? lat3 : 1 - lat3) // correlation FLIPS in test era ⇒ gap/Brier STOP
    lines.push(JSON.stringify({ slate, cls: "batter_pitcher_opposition", a: { p: "E", f: "hits", s: "over", l: 0.5, mp: 0.5, w: a3 }, b: { p: "F", f: "ks", s: "over", l: 0.5, mp: 0.5, w: b3 }, ev: "e2" }))
  }
}
fs.writeFileSync(path.join(tmp, "corpus.jsonl"), lines.join("\n") + "\n")
const env = { ...process.env, G3_PAIR_OUT: path.join(tmp, "corpus.jsonl"), G3_VAL_OUT: path.join(tmp, "val.json"), G3_VAL_MD: path.join(tmp, "report.md") }
const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "deriveMlbCorrelationPriors.js"), "--g3"], { env, encoding: "utf8", timeout: 120000 })
check(`e2e: --g3 run exits 0 (${(r.stderr || "").split("\n")[0] || "ok"})`, r.status === 0)
let val = null
try { val = JSON.parse(fs.readFileSync(path.join(tmp, "val.json"), "utf8")) } catch (_) {}
check("e2e: correlated class PASSES with recovered ρ>0.3", val && val.results.batter_batter_same_team?.verdict === "PASS" && val.results.batter_batter_same_team.rhoZ > 0.3)
check("e2e: independent cross_game CERTIFIED_INDEPENDENT with |ρ|<0.05", val && val.results.cross_game?.verdict === "CERTIFIED_INDEPENDENT" && Math.abs(val.results.cross_game.rhoZ) < 0.05)
check("e2e: era-flipped class STOPs (the bars catch train→test drift)", val && val.results.batter_pitcher_opposition?.verdict === "STOP")
check("e2e: report written with the verdict table + never-consumed-on-STOP doctrine", fs.existsSync(path.join(tmp, "report.md")) && /STOP classes are ABSENT from every consumer/.test(fs.readFileSync(path.join(tmp, "report.md"), "utf8")))
check("e2e: shadow priors file NOT written by --g3 (tmp has no mlbCorrelationPriors)", !fs.existsSync(path.join(tmp, "mlbCorrelationPriors.json")))

console.log(`verifyG3Correlation: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
