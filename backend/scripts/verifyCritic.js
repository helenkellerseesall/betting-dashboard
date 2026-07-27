"use strict"
// verifyCritic — nightly critic + re-point pass 2 (2026-07-26, debt paid).
// Claims: read-only critic (no record writes) · static-gate replay honesty
// (served_or_timing never guessed) · ceiling bar stated · weekly synthesis ·
// scheduler 05:40 + Sunday weekly + criticNightly alarm · RE-POINT PASS 2:
// verified-two_sided-only targets, haircut shown, repointed_served split in
// the critic, day-one honest-reach note · synthetic e2e attribution.
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const cr = rd("scripts/nightlyCritic.js")
check("critic: read-only (no writes to record files) + timing honesty + ceiling bar", !/writeFileSync\([^)]*tracked_(bets|best)/.test(cr) && /served_or_timing rows excluded, never guessed/.test(cr) && /≤7% healthy/.test(cr))
check("critic: weekly synthesis w/ honest-limits paragraph", /--weekly/.test(cr) && /HONEST LIMITS/.test(cr) && /which refusals are discipline, and which are leaks/.test(cr))
const sched = rd("scripts/scheduler.sh")
check("wiring: 05:40 nightly + Sunday weekly + alarm", /MIN" -eq 40 \] && \[ "\$HOUR" -eq 5/.test(sched) && /--weekly/.test(sched) && /checkCritic/.test(rd("scripts/componentHealthCheck.js")))

const wr = rd("routes/workstationRoutes.js")
check("repoint: verified-two_sided-only targets + started-game guard + haircut fields", /fmt\.sides !== "two_sided"\) continue \/\/ verified-sellable ONLY/.test(wr) && /repointHaircutPp/.test(wr) && /repointedServed/.test(wr))
check("repoint: honest day-one reach note + critic weekly re-measure in source", /day-one re-points ≈ 0/.test(wr) && /critic re-measures weekly/.test(wr))
check("repoint: critic splits repointed_served from unpurchasable_under", /repointed_served/.test(cr) && /sellableTuples\.add\(key\)/.test(cr))
check("repoint FE: haircut shown on the card", /re-pointed \(best/.test(rd("../frontend/mobile/index.html")))

// synthetic e2e: attribution on a tmp record
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "critic-"))
const track = path.join(tmp, "t"); fs.mkdirSync(track)
const mk = (player, side, book, tier, result, odds, fam = "hits") => ({ player, statFamily: fam, side, line: 1.5, sportsbook: book, oddsAmerican: odds, tier, result, edge: 0.02, modelProbRaw: 0.3 })
fs.writeFileSync(path.join(track, "mlb_tracked_bets_2026-07-20.json"), JSON.stringify([
  mk("A Win", "under", "DraftKings", "PLAYABLE", "win", -200),               // unpurchasable_under (no sellable alt)
  mk("B Win", "under", "DraftKings", "PLAYABLE", "win", -200),               // has FD sellable alt ⇒ repointed_served
  mk("B Win", "under", "FanDuel", "PLAYABLE", "win", -220),                  // the verified alt (FD hits two_sided)
  mk("C Win", "over", "FanDuel", "FADE", "win", 400),                        // fade_tier
  mk("D Loss", "over", "FanDuel", "PLAYABLE", "loss", 100),                  // pool loss
]))
const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "nightlyCritic.js"), "2026-07-20"], { env: { ...process.env, CRITIC_TRACKING_DIR: track, CRITIC_DATA_DIR: tmp }, encoding: "utf8", timeout: 60000 })
let art = null
try { art = JSON.parse(fs.readFileSync(path.join(track, "critic_2026-07-20.json"), "utf8")) } catch (_) {}
check(`e2e: critic runs (${r.status}) + artifact written`, r.status === 0 && !!art)
check("e2e: attribution exact — 1 unpurchasable, 1 repointed_served, 1 fade; D-loss in pool only", art && art.missedWinners.byReason.unpurchasable_under === 1 && art.missedWinners.byReason.repointed_served === 1 && art.missedWinners.byReason.fade_tier === 1)
check("e2e: shown-vs-pool computed (pool 5 rows; FD under B in shown set)", art && art.shownVsPool.pool.n === 5 && art.shownVsPool.shownApprox.n >= 1)

console.log(`verifyCritic: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
