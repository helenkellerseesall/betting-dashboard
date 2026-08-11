"use strict"
// verifyGraduationBoard — GRADUATION BOARD (2026-07-30, ASK f5ee1b6):
// one read-only aggregator over existing artifacts, /status + /m sections,
// stall alarm #24 (N=2, derived from the real 7/25-27 plateau), Sunday
// synthesis hook, in-sample labels + "too new" honesty. Hermetic tmp dirs.
const fs = require("fs")
const os = require("os")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const gb = require("./graduationBoard")

// ── synthetic world: 4 games-slates; rung artifacts replay the REAL 7/25-27
// plateau shape (advance → flat → flat) so the stall detector is pinned to
// the incident that calibrated it ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gbd-"))
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "gbc-"))
const slates = ["2026-07-24", "2026-07-25", "2026-07-26", "2026-07-27"]
for (const s of slates) fs.writeFileSync(path.join(tmp, `mlb_tracked_bets_${s}.json`), JSON.stringify([{ player: "A", gameTime: s + "T23:00:00Z" }]))
const rung = (slate, nights, decided, units, cureA) => fs.writeFileSync(path.join(tmp, `mlb_rung_scan_${slate}.json`), JSON.stringify({ summary: { gate: { nights, decided, flatUnits: units, pooledGapPp: 2.1 }, cureGates: { A: { decided: cureA, flatUnits: -1 }, B: { decided: 0, flatUnits: 0 }, C: { decided: 0, flatUnits: 0 } } } }))
rung("2026-07-24", 7, 1292, -93, 500)
rung("2026-07-25", 8, 1592, -261, 600)   // advance
rung("2026-07-26", 8, 1592, -261, 600)   // flat 1
rung("2026-07-27", 8, 1592, -261, 600)   // flat 2 ⇒ STALLED
fs.writeFileSync(path.join(tmp, "mlb_parlay_scan_2026-07-26.json"), JSON.stringify({ gate: { nights: 6, decided: 1008, flatUnits: -1008 } }))
fs.writeFileSync(path.join(tmp, "mlb_parlay_scan_2026-07-27.json"), JSON.stringify({ gate: { nights: 7, decided: 1167, flatUnits: -1167 } }))  // advancing
// exam artifact OLD (07-16-shaped): missing doubles/triples/stolenBases, TB/RBIs STOP
fs.writeFileSync(path.join(cfg, "g2_validation.json"), JSON.stringify({ generatedAt: "2026-07-16T07:34:09Z", bars: { passMinN: 150 }, verdicts: { hits: { verdict: "PASS", nPairs: 84568 }, totalBases: { verdict: "STOP", nPairs: 157093 }, rbis: { verdict: "STOP", nPairs: 88461 } } }))

const board = gb.buildBoard({ trackingDir: tmp, configDir: cfg })
const byKey = Object.fromEntries(board.rows.map((r) => [r.key, r]))
check("board: all 11 scoped rows present (3 family exams · TB+RBIs re-point · rung · cure A/B/C SPLIT · parlay · queued prior)",
  board.rows.length === 11 && ["fam_sb", "fam_doubles", "fam_triples", "repoint_tb", "repoint_rbis", "rung_gate", "cure_A", "cure_B", "cure_C", "parlay_gate", "market_prob_prior"].every((k) => byKey[k]))
check("stall N=2 pinned to the real plateau shape: rung + cure_A STALLED after two flat games-slates",
  byKey.rung_gate.status === "stalled" && byKey.cure_A.status === "stalled" && board.stalledRows.includes("rung_gate"))
check("PER-COLUMN SPLIT (2026-08-11): a dead column is visible in its OWN row — C shows 0 decided + own stall + clock-restart note; A's advance stays independent (07-25)",
  byKey.cure_C.decided.have === 0 && byKey.cure_C.status === "stalled" && /RESTARTED AT ZERO 2026-08-11/.test(byKey.cure_C.examNights.note || "") && byKey.cure_A.lastAdvance === "2026-07-25" && byKey.cure_B.status === "stalled")
check("advancing row stays CAGED (parlay gate moved 6→7 nights)", byKey.parlay_gate.status === "caged")
check("lastAdvance honest: rung last advanced 2026-07-25", byKey.rung_gate.lastAdvance === "2026-07-25")
check("never-examined family: absent from artifact ⇒ NOT_EXAMINED + predates-wiring note + stalled",
  byKey.fam_doubles.verdict === "NOT_EXAMINED" && /PREDATES this family's wiring/.test(byKey.fam_doubles.examNights.note) && byKey.fam_doubles.status === "stalled")
check("re-point rows read the exam verdicts verbatim (TB/RBIs STOP, nPairs carried, bar from file)",
  byKey.repoint_tb.verdict === "STOP" && byKey.repoint_tb.decided.have === 157093 && byKey.repoint_tb.decided.bar === 150 && /runbook re-point/.test(byKey.repoint_tb.unlock))
check("trend honesty: <8 artifacts ⇒ 'too new', never a fabricated arrow", byKey.rung_gate.trend.label === "too new" && byKey.parlay_gate.trend.label === "too new")
check("in-sample labels ride the paper rows + queued row refuses fake progress",
  /IN-SAMPLE shadow units/.test(byKey.rung_gate.paperNote) && /refusing/.test(byKey.parlay_gate.paperNote) && byKey.market_prob_prior.status === "queued" && /QUEUED — CA spec after gates read green/.test(byKey.market_prob_prior.unlock))
check("named unlock conditions verbatim (rung 14/300/1.5pp/≥0u/split-half · parlay 14/100/3pp/≥0u/operator)",
  /14 nights · 300 decided · pooled gap ≤1\.5pp · ≥0u · split-half/.test(byKey.rung_gate.unlock) && /14 nights · 100 settled · ≤3pp price error · ≥0u · operator approval/.test(byKey.parlay_gate.unlock))
// trend computed when ≥8 artifacts exist
const many = fs.mkdtempSync(path.join(os.tmpdir(), "gbm-"))
for (let i = 1; i <= 9; i++) { const s = `2026-07-${String(10 + i).padStart(2, "0")}`; fs.writeFileSync(path.join(many, `mlb_tracked_bets_${s}.json`), JSON.stringify([{ player: "A", gameTime: s }])); fs.writeFileSync(path.join(many, `mlb_rung_scan_${s}.json`), JSON.stringify({ summary: { gate: { nights: i, decided: i * 10, flatUnits: -10 * i } } })) }
const b2 = gb.buildBoard({ trackingDir: many, configDir: cfg })
const r2 = b2.rows.find((r) => r.key === "rung_gate")
check("trend computed with ≥8 artifacts: −70u vs 7 slates ago, exact", r2.trend.deltaUnits === -70 && /-70u vs 7 slates ago/.test(r2.trend.label) && r2.status === "caged")

// ── source anchors ──
check("aggregator: read-only doctrine + honesty rules in source", /no new experiments/.test(rd("scripts/graduationBoard.js")) && /never a fabricated arrow/i.test(rd("scripts/graduationBoard.js")) && /NEVER trusts this sidecar/.test(rd("scripts/graduationBoard.js")))
const sr = rd("routes/statusRoute.js")
check("/status route: sectionGraduationBoard reads the sidecar, wired into both payload call sites", /sectionGraduationBoard/.test(sr) && (sr.match(/out\.graduationBoard {3}= sectionGraduationBoard\(\)/g) || []).length === 2 && /NEVER computes the board in-request/.test(sr))
const sf = rd("../frontend/status/index.html")
check("/status FE: board card + renderer + stall-red summary + in-sample legend", /cardGraduationBoard/.test(sf) && /renderGraduationBoard\(data\)/.test(sf) && /STALLED: /.test(sf) && /IN-SAMPLE shadow numbers/.test(sf))
const fe = rd("../frontend/mobile/index.html")
check("/m FE: compact collapsed section via /api/ws/graduation-board, additive, refusing-gate honesty", /GRADUATION BOARD — caged surfaces/.test(fe) && /graduation-board\?_t=/.test(fe) && /a refusing gate is a working gate/.test(fe))
check("route: GET /graduation-board serves the sidecar read-only", /router\.get\("\/graduation-board"/.test(rd("routes/workstationRoutes.js")))
const sch = rd("scripts/scheduler.sh")
check("scheduler: aggregator fires 17:25 / 22:25 / 05:45 w/ dedupe var", /graduationBoard\.js/.test(sch) && /last_gradboard_min/.test(sch) && /-eq 25/.test(sch) && /-eq 45/.test(sch))
const chc = rd("scripts/componentHealthCheck.js")
check("alarm #24: gradBoardStall recomputes via buildBoard from raw artifacts (never the sidecar), N=2 provenance, registered before the write", /checkGradBoardStall/.test(chc) && /"gradBoardStall"/.test(chc) && /NEVER from the sidecar this alarm guards/.test(chc) && /real 7\/25-27 plateau/.test(chc) && chc.indexOf("fs.writeFileSync(OUT") > chc.indexOf("checkGradBoardStall()"))
const wa = rd("scripts/weeklySurfaceAudit.js")
check("Sunday hook: weekly audit gains board synthesis + receipts chain verdict", /Graduation board \(caged → bettable\)/.test(wa) && /buildBoard/.test(wa) && /validateReceiptChain/.test(wa))
const sc = rd("scripts/scanRungEv.js")
check("cure-C root fix at source: season-cache teamIdx (batCache+pitCache), the phantom TRACKING readdir gone, no silent catch re-zeroing the index",
  /for \(const cache of \[batCache, pitCache\]\)/.test(sc) && sc.indexOf("readdirSync(TRACKING)") === -1 && /never quietly zero a column again/.test(sc))
check("abstain-reason tally: every null branch named + tally rides summary.cureGates.C as abstainsTonight",
  /oppoAbstains = \{ noBatterTeam: 0, noStarters: 0, noOpp: 0, noPitcherLogs: 0, noCurve: 0, thinLeague: 0, applied: 0 \}/.test(sc) && /abstainsTonight: \{ \.\.\.oppoAbstains \}/.test(sc))
check("matrix: verifyGraduationBoard registered", /"verifyGraduationBoard"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifyGraduationBoard: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
