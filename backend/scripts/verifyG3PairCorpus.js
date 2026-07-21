"use strict"
// verifyG3PairCorpus — G3-L1 pair-corpus extraction (2026-07-21, approved scope).
// Claims:
//   1. CLASSES — the five structural classes + cross_game tag correctly from
//      leg geometry (same player / same team / opposition / kinds); team-truth
//      absence ⇒ unclassified (never guessed); same-team batter/pitcher pairs
//      are NOT the opposition class.
//   2. LEG UNIT — decided win/loss only; ONE median-line reference leg per
//      (player, family, game); push/void/pending excluded.
//   3. DETERMINISM — cross-game sampling is LCG-seeded on the slate string
//      (two runs byte-identical); capped per slate.
//   4. ERA SLICE — pre/post-flip (2026-07-01) counts reported as a stability
//      slice, never a filter (full history fits — CA answer i).
//   5. READ-ONLY + wiring — no tracked-file writes; 05:30 scheduler regen;
//      pairCorpus health line (day-one alarm doctrine).
//   6. E2E — synthetic mini-record through tmp dirs produces exactly the
//      expected class counts.
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const src = fs.readFileSync(path.join(ROOT, "scripts", "buildMlbPairCorpus.js"), "utf8")

check("classes: five structural + cross_game; team-absence unclassified; same-team batter/pitcher excluded from opposition", /same_player_multi_family/.test(src) && /batter_batter_same_team/.test(src) && /batter_pitcher_opposition/.test(src) && /return null \/\/ team-dependent class needs team truth/.test(src) && /same-team batter\/pitcher pairs are not the opposition class/.test(src))
check("leg unit: decided-only + median-line canonical reference leg", /\["win", "loss"\]\.includes\(String\(r\.result\)\)/.test(src) && /median line = canonical reference leg/.test(src))
check("determinism: LCG seeded on slate; capped cross-game", /lcg\(slate\)/.test(src) && /CROSS_GAME_CAP_PER_SLATE = 2000/.test(src))
check("era slice: pre/post 2026-07-01 reported, not filtered", /FLIP_DAY = "2026-07-01"/.test(src) && /stability slice, not a filter/.test(src))
check("read-only doctrine: no writes into tracked bet/best/pick files", !/writeFileSync\([^)]*tracked_bets|writeFileSync\([^)]*tracked_best|writeFileSync\([^)]*mlb_picks/.test(src))
const sched = fs.readFileSync(path.join(ROOT, "scripts", "scheduler.sh"), "utf8")
check("wiring: 05:30 scheduler regen + dedupe var", /MIN" -eq 30 \] && \[ "\$HOUR" -eq 5/.test(sched) && /last_paircorpus_min/.test(sched))
const chc = fs.readFileSync(path.join(ROOT, "scripts", "componentHealthCheck.js"), "utf8")
check("alarm: pairCorpus health line registered (staleness + zero-pairs RED)", /checkPairCorpus/.test(chc) && /"pairCorpus"/.test(chc) && /STALE/.test(chc))

// ── synthetic e2e (tmp dirs; mount untouched) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g3pair-"))
const mkRow = (player, fam, team, ev, result, line = 0.5, extra = {}) => ({ player, statFamily: fam, team, eventId: ev, result, side: "over", line, modelProb: 0.3, gameTime: "2026-07-10T23:00:00Z", ...extra })
const rows = [
  mkRow("A One", "hits", "KC", "ev1", "win"), mkRow("A One", "rbis", "KC", "ev1", "loss"), // same_player pair
  mkRow("B Two", "hits", "KC", "ev1", "win"),  // same-team with A One (hits+hits, hits+rbis)
  mkRow("C Three", "hits", "BOS", "ev1", "loss"), // opposing batter
  mkRow("P Four", "ks", "BOS", "ev1", "win"),   // pitcher opposing KC batters; same-team as C Three ⇒ NOT opposition
  mkRow("D Five", "hits", "NYY", "ev2", "win"), // second game ⇒ cross_game samples
  mkRow("D Five", "hits", "NYY", "ev2", "win", 1.5), // duplicate tuple, different line ⇒ median dedupe to ONE leg
  mkRow("E Six", "hits", "NYY", "ev2", "push"), // excluded (undecided)
]
fs.writeFileSync(path.join(tmp, "mlb_tracked_bets_2026-07-10.json"), JSON.stringify(rows))
const env = { ...process.env, G3_TRACKING_DIR: tmp, G3_PAIR_OUT: path.join(tmp, "corpus.jsonl"), G3_PAIR_SUMMARY: path.join(tmp, "summary.json") }
const r1 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "buildMlbPairCorpus.js")], { env, encoding: "utf8", timeout: 60000 })
check(`e2e: extractor exits 0 (${(r1.stderr || "").split("\n")[0] || "ok"})`, r1.status === 0)
let sum = null
try { sum = JSON.parse(fs.readFileSync(path.join(tmp, "summary.json"), "utf8")) } catch (_) {}
// expected same-game pairs among legs {A1.hits, A1.rbis, B2.hits, C3.hits, P4.ks} (E-push excluded, D5 deduped in ev2):
//   same_player: A1.hits×A1.rbis = 1
//   same_team:   A1.hits×B2.hits + A1.rbis×B2.hits = 2
//   opposing bb: A1×C3 (hits,rbis) + B2×C3 = 3
//   opposition:  P4 vs A1.hits, A1.rbis, B2.hits = 3 (NOT C3 — same team)
check("e2e: exact class counts (1 same-player / 2 same-team / 3 opposing / 3 opposition)", sum && sum.classCounts.same_player_multi_family === 1 && sum.classCounts.batter_batter_same_team === 2 && sum.classCounts.batter_batter_opposing === 3 && sum.classCounts.batter_pitcher_opposition === 3)
check("e2e: cross_game sampled; era slice attributes the 07-10 slate to POST-flip", sum && sum.classCounts.cross_game > 0 && (sum.eraSlice.post.cross_game || 0) === sum.classCounts.cross_game && (sum.eraSlice.pre.cross_game || 0) === 0)
const r2 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "buildMlbPairCorpus.js")], { env, encoding: "utf8", timeout: 60000 })
check("e2e: determinism — second run byte-identical corpus", r2.status === 0 && fs.readFileSync(path.join(tmp, "corpus.jsonl"), "utf8").length > 0 && fs.readFileSync(path.join(tmp, "corpus.jsonl"), "utf8") === fs.readFileSync(path.join(tmp, "corpus.jsonl"), "utf8") && (() => { const a = fs.readFileSync(path.join(tmp, "corpus.jsonl"), "utf8"); const r3 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "buildMlbPairCorpus.js")], { env, encoding: "utf8", timeout: 60000 }); return r3.status === 0 && fs.readFileSync(path.join(tmp, "corpus.jsonl"), "utf8") === a })())

console.log(`verifyG3PairCorpus: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
