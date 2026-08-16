"use strict"
// verifyCriticNet — FADE-TIER AUDIT queue addition (2026-08-15, CA §4):
// longshot_tier/fade_tag split (the fade_tier label lied — zero FADE rows) ·
// per-segment NET beside the gross missed-winners line (audit §2 automated) ·
// watch-segment lines w/ the promotion bar printed (n≥600 AND NET>0 AND
// Poisson LB90 ≥1.0 — gate-adjustment ASK only when met). Hermetic.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const { slateDateForTimestamp } = require("../pipeline/shared/slateDate")
const slate = slateDateForTimestamp(Date.now() - 86400000)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cn-"))
const docs = fs.mkdtempSync(path.join(os.tmpdir(), "cnd-"))
const mk = (over) => ({ sportsbook: "draftkings", side: "over", line: 0.5, player: "P " + Math.random().toString(36).slice(2, 7), ...over })
const rows = [
  mk({ player: "H Win", statFamily: "hits", tier: "LONGSHOT", oddsAmerican: 600, result: "win" }),
  ...Array.from({ length: 8 }, (_, i) => mk({ player: "H L" + i, statFamily: "hits", tier: "LONGSHOT", oddsAmerican: 700, result: "loss" })),
  mk({ player: "TB Fade", statFamily: "totalBases", tier: "FADE", oddsAmerican: 500, result: "win" }),
  mk({ player: "HR TW", statFamily: "hr", tier: "LONGSHOT", oddsAmerican: 800, result: "win", openImpliedProb: 0.10, closeImpliedProb: 0.12 }),
  mk({ player: "HR TL", statFamily: "hr", tier: "LONGSHOT", oddsAmerican: 900, result: "loss", openImpliedProb: 0.10, closeImpliedProb: 0.115 }),
  mk({ player: "HR FL", statFamily: "hr", tier: "LONGSHOT", oddsAmerican: 900, result: "loss", openImpliedProb: 0.10, closeImpliedProb: 0.102 }),
  mk({ player: "KS AW", statFamily: "ks", tier: "LONGSHOT", oddsAmerican: 600, result: "loss", openImpliedProb: 0.20, closeImpliedProb: 0.18 }),
  mk({ player: "PL Served", statFamily: "hits", tier: "PLAYABLE", oddsAmerican: -120, result: "win" }),
]
fs.writeFileSync(path.join(tmp, `mlb_tracked_bets_${slate}.json`), JSON.stringify(rows))
const env = { ...process.env, CRITIC_TRACKING_DIR: tmp, CRITIC_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "cnx-")), CRITIC_DOCS_DIR: docs }
const r1 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "nightlyCritic.js"), slate], { env, encoding: "utf8", timeout: 60000 })
const art = JSON.parse(fs.readFileSync(path.join(tmp, `critic_${slate}.json`), "utf8"))

check(`split: byReason carries longshot_tier=2 + fade_tag=1, NO fade_tier key (exit ${r1.status})`,
  r1.status === 0 && art.missedWinners.byReason.longshot_tier === 2 && art.missedWinners.byReason.fade_tag === 1 && art.missedWinners.byReason.fade_tier === undefined)
const fam = art.refusedNet.byFamily
check("refusedNet §2 math exact: hits n=9 win% via 1 win, gross +6.0, NET −2.0 (winners-only glare vs whole-pool truth)",
  fam.hits.n === 9 && fam.hits.wins === 1 && fam.hits.grossWinnerUnits === 6 && fam.hits.netUnits === -2)
check("refusedNet: FADE row counted (totalBases +5.0 net) and total n=14 net +8.0 — winners AND losers, flat $1",
  fam.totalBases.n === 1 && fam.totalBases.netUnits === 5 && art.refusedNet.total.n === 14 && art.refusedNet.total.netUnits === 8)
check("watch §3: hrToward n=2 wins=1 NET +7.0 w/ breakeven E=0.21 (Σ implied at recorded odds); flat row excluded",
  art.watchSegments.hrToward.n === 2 && art.watchSegments.hrToward.wins === 1 && art.watchSegments.hrToward.netUnits === 7 && art.watchSegments.hrToward.breakevenWinsExpected === 0.21)
check("watch §3: ksAway n=1 wins=0 NET −1.0 (away = close moved AGAINST)",
  art.watchSegments.ksAway.n === 1 && art.watchSegments.ksAway.wins === 0 && art.watchSegments.ksAway.netUnits === -1)

const r2 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "nightlyCritic.js"), "--weekly"], { env, encoding: "utf8", timeout: 60000 })
const mdFile = fs.readdirSync(docs).find((f) => /^weekly-critic-/.test(f))
const md = mdFile ? fs.readFileSync(path.join(docs, mdFile), "utf8") : ""
check(`weekly: NET line beside the gross (exit ${r2.status}) — "+8.0u across 14 refused rows" + survivorship-glare phrasing`,
  r2.status === 0 && /Whole-pool NET of the refused rows/.test(md) && /\+8\.0u across 14 refused rows/.test(md) && /survivorship glare/.test(md))
check("weekly: §2 table row exact — | hits | 9 | 11.1% | +6.0 | **-2.0u** |",
  md.includes("| hits | 9 | 11.1% | +6.0 | **-2.0u** |"))
check("weekly: split keys in the gate table (longshot_tier + fade_tag rows)",
  /\| longshot_tier \| 2 \|/.test(md) && /\| fade_tag \| 1 \|/.test(md))
check("weekly: watch lines w/ full bar printed and CLOSED (n≥600 not met — nothing fires on vibes)",
  /hr × market-toward: cumulative n=2, wins=1 \(50\.0%\), NET \+7\.0u/.test(md) && /n≥600: not met/.test(md) && /CLOSED \(no gate change\)/.test(md) && /ks × market-away: cumulative n=1/.test(md))
check("weekly: promotion path is an ASK, never an auto-change (text pinned)",
  /file the gate-adjustment ASK \(hard-gated; nothing auto-changes\)/.test(rd("scripts/nightlyCritic.js")))

// source anchors
const src = rd("scripts/nightlyCritic.js")
check("source: split provenance (zero FADE rows census) + statelessly-cumulative doctrine + Poisson LB90 formula documented",
  /LONGSHOT 128,589 · FADE\s*\/\/ 0/.test(src.replace(/\n {2}/g, " ")) || /ZERO FADE rows/.test(src))
check("source: cumulative recompute is stateless (re-running --weekly can never double-count)",
  /STATELESSLY from every critic\s+\/\/ artifact on disk/.test(src.replace(/\n {2}/g, " ")) || /never double-count/.test(src))
check("source: LB90 = \\(W − 1.2816·√W\\)/E documented at the bar", /1\.2816/.test(src) && /LB90/.test(src))
check("matrix: verifyCriticNet registered", /"verifyCriticNet"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifyCriticNet: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
