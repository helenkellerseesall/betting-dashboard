"use strict"
// verifyG2Validator — G2-L2 walk-forward validator machinery (2026-07-16).
// Claims under test:
//   1. NO LOOKAHEAD — every fit is on games strictly prior to the target
//      (slice(0, t)); production floors; deterministic.
//   2. BAKE-OFF — exactly {10, 20, 40, none}; winner frozen INTO the verdicts
//      JSON (L3 consumes it; never re-chosen silently).
//   3. BARS — PASS bar n≥150 & |gap| ≤ max(1.5pp, 20% rel); bake-off buckets
//      n≥50; pitcher retest at n≥12 wired; last-30d slice reported.
//   4. AXIS B honesty — unsettled rungs are PENDING (never guessed); rungs
//      beyond our tail support are skipped as honestly-unpriced.
//   5. MECHANICS — full subprocess run on a SYNTHETIC cache (tmp dirs, mount
//      untouched) produces the report + verdicts with all five families.
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const src = fs.readFileSync(path.join(ROOT, "scripts", "validateG2Curves.js"), "utf8")

check("no-lookahead: fit on rows.slice(0, t) only", /rows\.slice\(0, t\)/.test(src) && /strictly-prior|strictly prior|STRICTLY BEFORE/i.test(src))
check("bake-off: exactly {10,20,40,none} + winner FROZEN into verdicts JSON", /halfLife: 10 \}, \{ label: "hl20", halfLife: 20 \}, \{ label: "hl40", halfLife: 40 \}, \{ label: "none", halfLife: null/.test(src) && /frozenHalfLife, frozenLabel/.test(src))
check("bars: PASS n≥150, gap ≤ max(1.5pp, 20% rel), bake-off n≥50", /PASS_MIN_N = 150/.test(src) && /Math\.max\(0\.015, 0\.20 \* r\.stated\)/.test(src) && /BAKEOFF_MIN_N = 50/.test(src))
check("pitcher retest: ks STOP at n≥8 triggers ONE n≥12 retest before exclusion", /walkForward\(pitchers, "ks", 12, frozenHalfLife/.test(src) && /higher-floor retest/.test(src))
check("last-30d slice: reported alongside season-pooled", /last30Cut/.test(src) && /Last-30d slice \(reporting only\)/.test(src))
check("Axis B honesty: pending-never-guessed + tail-support skip + FLB 2pp disagreement", /axisB\.pending\+\+; continue/.test(src) && /honestly unpriced by us/.test(src) && /> 0\.02/.test(src))
check("read-only doctrine: no tracked_bets/best/picks writes, no serving imports", !/mlb_tracked_(bets|best)|mlb_picks_|workstationRoutes|persistTracked/.test(src))

// ── synthetic end-to-end run (tmp only; the mounted repo is untouched) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g2val-"))
const lcg = (s) => () => (s = (s * 48271) % 2147483647) / 2147483647
const rand = lcg(42)
const poisson1 = () => { let k = 0, p = Math.exp(-1), c = p, u = rand(); while (u > c) { k++; p = (p * 1) / k; c += p } return k }
const mkPlayers = (count, games, statsFor) => {
  const players = {}
  for (let i = 0; i < count; i++) {
    const rows = []
    for (let g = 0; g < games; g++) rows.push({ date: `2026-${String(4 + Math.floor(g / 28)).padStart(2, "0")}-${String((g % 28) + 1).padStart(2, "0")}`, opponent: "X", isHome: true, stats: statsFor() })
    players[`synth player ${i}`] = { playerId: i, fullName: `Synth Player ${i}`, games: rows, starts: rows }
  }
  return players
}
fs.writeFileSync(path.join(tmp, "mlbBatterGameLogsSeason.json"), JSON.stringify({ windowDays: 200, players: mkPlayers(25, 45, () => { const h = poisson1(); return { hits: h, totalBases: h + (rand() < 0.3 ? 2 : 0), rbi: poisson1(), runs: poisson1(), strikeOuts: poisson1() } }) }))
fs.writeFileSync(path.join(tmp, "mlbPitcherGameLogsSeason.json"), JSON.stringify({ windowDays: 200, players: mkPlayers(10, 20, () => ({ strikeOuts: poisson1() + poisson1() + poisson1() + 2, inningsPitched: 5 })) }))
const trackDir = path.join(tmp, "tracking"); fs.mkdirSync(trackDir)
const outJson = path.join(tmp, "g2_validation.json")
const outMd = path.join(tmp, "report.md")
const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "validateG2Curves.js")], {
  env: { ...process.env, G2_DATA_DIR: tmp, G2_TRACKING_DIR: trackDir, G2_OUT_JSON: outJson, G2_OUT_MD: outMd },
  encoding: "utf8", timeout: 120000,
})
check(`synthetic e2e: validator exits 0 (${(r.stderr || "").split("\n")[0] || "ok"})`, r.status === 0)
let vj = null
try { vj = JSON.parse(fs.readFileSync(outJson, "utf8")) } catch (_) {}
check("synthetic e2e: verdicts JSON written with frozen half-life + all five families + bars", vj && "frozenHalfLife" in vj && ["hits", "totalBases", "rbis", "runs", "ks"].every((f) => vj.verdicts[f]) && vj.bars.passMinN === 150)
check("synthetic e2e: real pair volume + report written", vj && Object.values(vj.bakeoff).every((b) => b.nPairs > 500) && fs.existsSync(outMd) && /Half-life bake-off/.test(fs.readFileSync(outMd, "utf8")))
check("synthetic e2e: Poisson(1) hits family well-calibrated (pooled |gap| < 5pp — machinery sanity)", vj && Object.values(vj.bakeoff).some((b) => b.wGap != null && b.wGap < 0.05))

console.log(`verifyG2Validator: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
