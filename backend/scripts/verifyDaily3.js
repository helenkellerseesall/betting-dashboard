"use strict"
// verifyDaily3 — THE DAILY 3 (2026-07-14, break-window Part 3). The public-
// record seed — integrity guards:
//   1. LOCK: write-once (existing file ⇒ no-op, race-guarded), first-pitch−60min
//      window, NO card once the pitch passes unlocked, lockLate stamped, picks
//      from the SERVED lens (self-HTTP to /top-picks — the exact operator view).
//   2. GRADE: write-once results, EXISTING nightly only (tuple join on graded
//      tracked rows), grades only when all picks decided, flat-$1 units math.
//   3. READ: honest aggregates — net units shown WITH win rate (win rate alone
//      lies), small-sample label under 30 decided.
//   4. Wiring: server minute-tick + runHistoricalGrade hook + /api/ws/daily3 +
//      FE card above the board (failure never blocks the board).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const d3 = rd("pipeline/shared/daily3.js")
check("lock: write-once + race guard (existing file ⇒ never rewritten)", /if \(fs\.existsSync\(fp\)\) return \/\/ IMMUTABLE/.test(d3) && /if \(fs\.existsSync\(fp\)\) return \/\/ race guard/.test(d3))
check("lock: first-pitch−60min window; pitch passed unlocked ⇒ NO card (integrity)", /now < pitch - 60 \* 60000/.test(d3) && /if \(now >= pitch\) return \/\/ first pitch passed unlocked/.test(d3))
check("lock: picks from the SERVED lens (self-HTTP /top-picks) + lockLate stamped", /api\/ws\/top-picks\?limit=10/.test(d3) && /lockLate: now > pitch - 55 \* 60000/.test(d3))
check("lock: first-pitch source = tracked_best PRIMARY (started games persist; snapshot events drop them) + snapshot fallback", /mlb_tracked_best_\$\{slate\}\.json/.test(d3) && d3.indexOf("mlb_tracked_best_") < d3.indexOf("snapshot-mlb.json"))
check("grade: write-once + existing-nightly-only + complete-or-wait", /if \(card\.results\) return \{ skipped: "already_graded" \}/.test(d3) && /picks_still_pending/.test(d3))
check("grade: flat-$1 units math (win=+american profit, loss=−1, push/void=0)", /res === "win" \? unitProfit\(p\.odds\) : res === "loss" \? -1 : 0/.test(d3))
// units math unit-tests (pure)
const { unitProfit } = require("../pipeline/shared/daily3")
check("unitProfit: +150 ⇒ +1.5 · −110 ⇒ +0.909 · junk ⇒ 0", unitProfit(150) === 1.5 && Math.abs(unitProfit(-110) - 0.9091) < 0.001 && unitProfit(null) === 0)
check("read: net units WITH win rate + small-sample honesty under 30 decided", /smallSample: decided < 30/.test(d3) && /not yet meaningful/.test(d3))

check("wiring: server 1-min lock tick", /maybeLockDaily3, 60 \* 1000/.test(rd("server.js")))
check("wiring: nightly grade hook (mlb, non-dry)", /gradeDaily3\(date\)/.test(rd("scripts/runHistoricalGrade.js")))

// ── 2026-08-18 FINALS-ABSENCE (GO on the 08b31a1 mini-ASK) — the Lockridge
// 8/15 shape pinned EXACTLY: graded loss + graded win + a no-appearance pick
// whose gamelog guard cannot conclude, resolved by a PRESENT finals cache.
{
  const os = require("os")
  const { spawnSync } = require("child_process")
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "d3fa-"))
  const R = fs.mkdtempSync(path.join(os.tmpdir(), "d3fr-"))
  const oldSlate = "2026-08-01" // ≥2 days old always
  fs.writeFileSync(path.join(T, `daily3_${oldSlate}.json`), JSON.stringify({ slate: oldSlate, lockedAt: oldSlate + "T16:00:00Z", picks: [
    { player: "L Loser", statFamily: "hits", side: "under", line: 1.5, odds: -110, sportsbook: "BetMGM" },
    { player: "W Winner", statFamily: "hits", side: "under", line: 1.5, odds: 120, sportsbook: "BetMGM" },
    { player: "S Scratch", statFamily: "runs", side: "over", line: 0.5, odds: 150, sportsbook: "BetMGM" },
  ] }))
  fs.writeFileSync(path.join(T, `mlb_tracked_bets_${oldSlate}.json`), JSON.stringify([
    { player: "L Loser", statFamily: "hits", side: "under", line: 1.5, sportsbook: "BetMGM", result: "loss", actualValue: 2 },
    { player: "W Winner", statFamily: "hits", side: "under", line: 1.5, sportsbook: "BetMGM", result: "win", actualValue: 0 },
    { player: "S Scratch", statFamily: "runs", side: "over", line: 0.5, sportsbook: "BetMGM" }, // pending forever — the scratch class
  ]))
  const finals = {}
  for (let i = 0; i < 60; i++) finals["player " + i] = { _batting: { hits: 1 } } // PRESENT + ≥50, Scratch ABSENT
  fs.writeFileSync(path.join(T, `mlb_finals_${oldSlate}.json`), JSON.stringify(finals))
  const env = { ...process.env, DAILY3_TRACKING_DIR: T, DAILY3_RECEIPTS_DIR: R }
  const r = spawnSync(process.execPath, ["-e", `
    const d3 = require(${JSON.stringify(path.join(ROOT, "pipeline", "shared", "daily3"))})
    console.log(JSON.stringify(d3.gradeDaily3("${oldSlate}")))
  `], { env, encoding: "utf8", timeout: 30000 })
  let out = null; try { out = JSON.parse(r.stdout.trim().split("\n").pop()) } catch (_) {}
  const card = JSON.parse(fs.readFileSync(path.join(T, `daily3_${oldSlate}.json`), "utf8"))
  const res = (card.results || []).map((x) => x.result)
  check(`FINALS-ABSENCE e2e (exit ${r.status}): the Lockridge shape grades 1-1-1V — loss + win + VOID from a PRESENT 60-player cache the player is absent from`,
    r.status === 0 && res.length === 3 && res[0] === "loss" && res[1] === "win" && res[2] === "void" && /voided per book behavior/.test(card.results[2].settleNote || ""))
  // never-guess guards: thin cache proves nothing ⇒ pick stays pending
  const T2 = fs.mkdtempSync(path.join(os.tmpdir(), "d3ft-"))
  fs.writeFileSync(path.join(T2, `daily3_${oldSlate}.json`), JSON.stringify({ slate: oldSlate, lockedAt: oldSlate + "T16:00:00Z", picks: [ { player: "S Scratch", statFamily: "runs", side: "over", line: 0.5, odds: 150, sportsbook: "BetMGM" } ] }))
  fs.writeFileSync(path.join(T2, `mlb_tracked_bets_${oldSlate}.json`), JSON.stringify([{ player: "S Scratch", statFamily: "runs", side: "over", line: 0.5, sportsbook: "BetMGM" }]))
  fs.writeFileSync(path.join(T2, `mlb_finals_${oldSlate}.json`), JSON.stringify({ "only one": {} }))
  const r2 = spawnSync(process.execPath, ["-e", `
    const d3 = require(${JSON.stringify(path.join(ROOT, "pipeline", "shared", "daily3"))})
    console.log(JSON.stringify(d3.gradeDaily3("${oldSlate}")))
  `], { env: { ...process.env, DAILY3_TRACKING_DIR: T2, DAILY3_RECEIPTS_DIR: R }, encoding: "utf8", timeout: 30000 })
  check("never-guess guard: a THIN finals cache (<50 players) proves nothing — card stays pending",
    /picks_still_pending/.test(r2.stdout))
  check("source: evidence doctrine at the branch (absence provable ONLY from a present cache; SEV-1 extends never weakens; accent-safe)",
    /provable ONLY from the cache's PRESENCE/.test(rd("pipeline/shared/daily3.js")) && /keys\.length >= 50/.test(rd("pipeline/shared/daily3.js")) && /normalize\("NFD"\)/.test(rd("pipeline/shared/daily3.js")))
}
check("wiring: GET /api/ws/daily3 read-only route", /router\.get\("\/daily3"/.test(rd("routes/workstationRoutes.js")))
const fe = rd("../frontend/mobile/index.html")
// EVOLVED 2026-08-18 (ITERATION-2, operator decision via CA): the Daily 3 card
// moved from the board to the TONIGHT home view; the record line lives on the
// home record strip. Prior anchors (THE DAILY 3 header, board-additive comment,
// "at flat $1" phrasing) retired with this provenance.
check("FE: Daily 3 card is the TONIGHT home lead; home never blocks on one card; record strip carries the record", /The Daily 3/.test(fe) && /additive — home never blocks on one card/.test(fe) && /DAILY 3 RECORD/.test(fe))
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE inline scripts parse${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

console.log(`verifyDaily3: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
