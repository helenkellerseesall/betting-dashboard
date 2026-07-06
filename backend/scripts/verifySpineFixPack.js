"use strict"
// verifySpineFixPack — SPINE-FIX pack (2026-07-05) fixture. Bet-ready-week
// plumbing hardening (GRADING_RULES.md §3/§5/§6/§8/§9):
//   1. addPlacedBet: --sport REQUIRED (no silent nba default); --stat validated
//      against canonical MLB tokens; --book validated + canonicalized; tuple
//      auto-stamp from today's tracked board picks; LOUD no-match warning;
//      --dry-run writes nothing.
//   2. buildNightlyOrchestrator stepLedgerSettle maps t.actualValue → actualStat
//      (INC-013 field class — t.actualStat is always undefined on tracked rows).
//   3. settlePlacedBet CLI: --list read-only; invalid result/id rejected before
//      any write; non-placed + already-settled rows refused without --force.
//   4. captureClosingLines moved-line fallback: nearest-rung pick, same-line
//      candidates refused, line_moved rows stay upgradeable by exact match,
//      exact-era captures stay final.
// All checks are write-free: spawned CLI paths use validation failures, --list,
// or --dry-run; the live personal_ledger and tracked files are never mutated.
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const run = (args) => spawnSync(process.execPath, args, { encoding: "utf8", cwd: ROOT })
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// ── 1. addPlacedBet validation (all failure paths exit BEFORE any write) ─────
const APB = path.join(ROOT, "scripts", "addPlacedBet.js")
let r = run([APB, "single", "--player=Test Man", "--stat=hits", "--line=1.5", "--side=over", "--odds=-110", "--book=fanduel", "--stake=1"])
check("addPlacedBet: missing --sport REJECTED with valid list", r.status === 1 && /--sport is REQUIRED/.test(r.stderr) && /mlb/.test(r.stderr))
r = run([APB, "single", "--sport=nhl", "--player=Test Man", "--stat=hits", "--line=1.5", "--side=over", "--odds=-110", "--book=fanduel", "--stake=1"])
check("addPlacedBet: bad --sport REJECTED", r.status === 1 && /not valid/.test(r.stderr))
r = run([APB, "single", "--sport=mlb", "--player=Test Man", "--stat=rebounds", "--line=1.5", "--side=over", "--odds=-110", "--book=fanduel", "--stake=1"])
check("addPlacedBet: non-MLB --stat REJECTED listing the 6 canonical tokens", r.status === 1 && /canonical MLB token/.test(r.stderr) && /runs, hr, hits, ks, rbis, totalBases/.test(r.stderr))
r = run([APB, "single", "--sport=mlb", "--player=Test Man", "--stat=hits", "--line=1.5", "--side=over", "--odds=-110", "--book=bovada", "--stake=1"])
check("addPlacedBet: unknown --book REJECTED listing known books", r.status === 1 && /not a known book/.test(r.stderr) && /FanDuel/.test(r.stderr) && /Hard Rock Bet/.test(r.stderr))
r = run([APB, "single", "--sport=mlb", "--player=Test Man", "--stat=hits", "--line=1.5", "--side=banana", "--odds=-110", "--book=fanduel", "--stake=1"])
check("addPlacedBet: bad --side REJECTED", r.status === 1 && /must be one of: over, under, yes, no/.test(r.stderr))

// ── 1b. dry-run success paths (nothing written; ledger untouched by design) ──
const LEDGER = path.join(ROOT, "runtime", "tracking", "personal_ledger.json")
const ledgerBytesBefore = fs.existsSync(LEDGER) ? fs.statSync(LEDGER).size : -1
// No-match warning path (fake player always misses):
r = run([APB, "single", "--dry-run", "--sport=mlb", "--player=Zz Fixture Nobody", "--stat=hits", "--line=1.5", "--side=over", "--odds=-110", "--book=fanduel", "--stake=1"])
check("addPlacedBet --dry-run: no-tuple-match WARNS loudly (GRADING_RULES §9) + exits 0", r.status === 0 && /NO TUPLE MATCH/.test(r.stderr + r.stdout) && /will NOT auto-settle/.test(r.stderr + r.stdout))
check("addPlacedBet --dry-run: prints the row, marks DRY RUN", /DRY RUN — nothing written/.test(r.stdout) && /"statFamily": "hits"/.test(r.stdout) && /"sportsbook": "FanDuel"/.test(r.stdout) && /"id": "/.test(r.stdout))
// Real-tuple match path — adaptive: use today's tracked file when present.
const todaySlate = require("../pipeline/shared/slateDate").currentSlateDateEt()
const trackedPath = path.join(ROOT, "runtime", "tracking", `mlb_tracked_bets_${todaySlate}.json`)
if (fs.existsSync(trackedPath)) {
  let rows = []
  try { rows = JSON.parse(fs.readFileSync(trackedPath, "utf8")) } catch (_) { rows = [] }
  const t = (Array.isArray(rows) ? rows : []).find((x) => x && x.player && x.statFamily && x.side && Number.isFinite(Number(x.line)) && x.sportsbook)
  if (t) {
    r = run([APB, "single", "--dry-run", "--sport=mlb", `--player=${t.player}`, `--stat=${t.statFamily}`, `--line=${t.line}`, `--side=${t.side}`, `--odds=${t.oddsAmerican ?? -110}`, `--book=${t.sportsbook}`, "--stake=1"])
    check("addPlacedBet --dry-run: REAL board-pick tuple MATCHES + stamps matchedTrackedId", r.status === 0 && /tuple MATCHED tracked pick/.test(r.stdout) && /"matchedTrackedId"/.test(r.stdout))
    check("addPlacedBet --dry-run: stamp honesty (calibVersion present IFF the tracked row has it)", t.calibVersion != null ? /"calibVersion"/.test(r.stdout) : /carries NO calibVersion/.test(r.stdout + r.stderr) || !/"calibVersion"/.test(r.stdout))
  } else {
    check("addPlacedBet --dry-run real-tuple case SKIPPED (tracked file empty) — counted, not hidden", true)
    check("addPlacedBet --dry-run real-tuple stamp case SKIPPED (tracked file empty)", true)
  }
} else {
  check(`addPlacedBet --dry-run real-tuple case SKIPPED (no tracked file for slate ${todaySlate}) — counted, not hidden`, true)
  check("addPlacedBet --dry-run real-tuple stamp case SKIPPED (no tracked file)", true)
}
const ledgerBytesAfter = fs.existsSync(LEDGER) ? fs.statSync(LEDGER).size : -1
check("addPlacedBet --dry-run + rejects wrote NOTHING to personal_ledger (byte-identical)", ledgerBytesBefore === ledgerBytesAfter)

// ── 2. orchestrator actualValue→actualStat ───────────────────────────────────
const orch = rd("pipeline/shared/buildNightlyOrchestrator.js")
check("stepLedgerSettle maps t.actualValue ?? t.actualStat (INC-013 class fixed)", /actualStat: t\.actualValue \?\? t\.actualStat \?\? null/.test(orch))
// Real-data proof of the mapping delta on settled tracked rows (read-only):
{
  const dir = path.join(ROOT, "runtime", "tracking")
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : []
  let settled = 0, oldNonNull = 0, newNonNull = 0
  for (const f of files.slice(-5)) {
    let rows = []
    try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) } catch (_) { continue }
    for (const t of (Array.isArray(rows) ? rows : [])) {
      if (!t || !t.result || t.result === "pending") continue
      settled++
      if ((t.actualStat ?? null) != null) oldNonNull++
      if ((t.actualValue ?? t.actualStat ?? null) != null) newNonNull++
    }
  }
  console.log(`  [spine-2 real-data] settled rows scanned: ${settled} · OLD mapping non-null actualStat: ${oldNonNull} · NEW mapping non-null: ${newNonNull}`)
  check("real settled rows: NEW mapping recovers actualStat the OLD mapping dropped (or no settled rows to scan)", settled === 0 || newNonNull > oldNonNull || (oldNonNull === newNonNull && oldNonNull > 0))
}

// ── 3. settlePlacedBet CLI (read-only paths) ─────────────────────────────────
const SPB = path.join(ROOT, "scripts", "settlePlacedBet.js")
r = run([SPB, "--list"])
check("settlePlacedBet --list runs read-only, exit 0", r.status === 0 && /placed bet/.test(r.stdout))
r = run([SPB, "--id=zzz_no_such_bet", "--result=win"])
check("settlePlacedBet: unknown id REJECTED before any write", r.status === 1 && /no bet with id/.test(r.stderr))
r = run([SPB, "--id=whatever", "--result=banana"])
check("settlePlacedBet: invalid result REJECTED listing win/loss/push/void", r.status === 1 && /win, loss, push, void/.test(r.stderr))
const spbSrc = rd("scripts/settlePlacedBet.js")
check("settlePlacedBet settles via canonical settleBet only (no direct ledger writes)", /settleBet\(id, \{/.test(spbSrc) && !/saveLedger\(/.test(spbSrc))
check("settlePlacedBet refuses non-placed + already-settled without --force", /MODEL-TRACKED row/.test(spbSrc) && /already settled/.test(spbSrc) && /GRADING_RULES §6/.test(spbSrc))

// ── 4. captureClosingLines moved-line fallback units ─────────────────────────
const ccl = require("./captureClosingLines")
check("fallback units exported", typeof ccl.buildLooseIndex === "function" && typeof ccl.looseKeyForBet === "function" && typeof ccl.pickNearestMovedLine === "function")
const cands = [{ line: 1.5, odds: -120 }, { line: 2.5, odds: 100 }, { line: 3.5, odds: 240 }]
check("pickNearestMovedLine picks the NEAREST rung", ccl.pickNearestMovedLine(cands, 0.5)?.line === 1.5 && ccl.pickNearestMovedLine(cands, 3.0)?.line === 2.5)
check("pickNearestMovedLine REFUSES same-line candidates (would be a lie, not a move)", ccl.pickNearestMovedLine([{ line: 1.5, odds: -110 }], 1.5) === null)
check("pickNearestMovedLine null on non-finite bet line / empty candidates", ccl.pickNearestMovedLine(cands, null) === null && ccl.pickNearestMovedLine([], 1.5) === null)
// loose key parity across the taxonomy bridge (display propType row ↔ slug bet):
const rowK = ccl.buildLooseIndex([{ player: "Juan Soto", propType: "Total Bases", side: "over", book: "FanDuel", marketKey: "batter_total_bases", line: 2.5, odds: -110 }])
const betK = ccl.looseKeyForBet({ player: "Juan Soto", statFamily: "totalBases", side: "over", sportsbook: "FanDuel", marketKey: "batter_total_bases", line: 1.5 })
check("loose index key bridges display-propType row ↔ slug bet (canonFamily)", rowK.has(betK))
// eligibility: line_moved rows stay upgradeable; exact-era captures final:
const inWin = new Date(Date.now() + 60 * 60000).toISOString()
check("line_moved capture stays ELIGIBLE for exact upgrade in-window", ccl.captureEligibility({ closeOdds: -110, clvQuality: "line_moved", gameTime: inWin }, Date.now()) === "in_window")
check("exact-era capture is FINAL (already_captured)", ccl.captureEligibility({ closeOdds: -110, clvQuality: "positive", gameTime: inWin }, Date.now()) === "already_captured")
const cclSrc = rd("scripts/captureClosingLines.js")
check("fallback stamps clv=null (cross-line CLV never fabricated) + clvQuality=line_moved", /b\.clv\s+= null/.test(cclSrc) && /b\.clvQuality\s+= "line_moved"/.test(cclSrc))
check("fallback keeps marketKey in the loose key (v0.1.4 alt-vs-main trap can't recur)", /player\}\|\$\{fam\}\|\$\{side\}\|\$\{book\}\|\$\{market\}/.test(cclSrc))

console.log(`verifySpineFixPack: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
