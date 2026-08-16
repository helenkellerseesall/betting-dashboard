"use strict"
// verifyMarketPrior — MARKET-PRIOR SHADOW v1 (2026-08-16, GO on the 8/15 ASK;
// spec §2/§4/§5): blend math · median de-vig consensus via the ONE join
// authority · SEV-1 side seam · shadow isolation (served picks byte-identical)
// · kill switch · fail-open labels · forward-only fit that THROWS backward ·
// w=1 no-support path · era-rule pin (no pipeline importer) · board flip.
const fs = require("fs")
const os = require("os")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const tmpW = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-"))
const tmpS = fs.mkdtempSync(path.join(os.tmpdir(), "mps-"))
process.env.MARKET_PRIOR_W_PATH = path.join(tmpW, "w.json")
process.env.MARKET_PRIOR_SHADOW_PATH = path.join(tmpS, "shadow.jsonl")
delete process.env.MARKET_PRIOR_OFF
const mp = require("../pipeline/shared/marketPrior")
const { buildPropIndex, matchKeyForBet } = require("../scripts/captureClosingLines")

// ── math + no-support stamp ──
check("blend: p_final = w·p_market + (1−w)·p_model exact", mp.blend(0.4, 0.6, 0.25) === 0.25 * 0.6 + 0.75 * 0.4)
const nf = mp.wFor("hits", "plus_mid", null)
check("no fit support ⇒ w=1 PURE MARKET with the stamp (spec §2)", nf.w === 1 && /no fit support — pure market/.test(nf.source))
check("bands: -200 heavy_fav · -105 fav · +150 plus_short · +300 plus_mid · +800 plus_long", mp.bandOf(-200) === "heavy_fav" && mp.bandOf(-105) === "fav" && mp.bandOf(150) === "plus_short" && mp.bandOf(300) === "plus_mid" && mp.bandOf(800) === "plus_long")

// ── consensus via the real join authority ──
const snapRow = (book, side, odds) => ({ player: "Test Guy", statFamily: "hits", side, line: 1.5, sportsbook: book, oddsAmerican: odds })
const rows = [snapRow("draftkings", "over", -110), snapRow("draftkings", "under", -110), snapRow("fanduel", "over", -200), snapRow("fanduel", "under", 150), snapRow("betmgm", "over", -110), snapRow("betmgm", "under", -110)]
const ctx = { ok: true, exactIx: buildPropIndex(rows) }
const pick = { player: "Test Guy", statFamily: "hits", side: "over", line: 1.5, modelProb: 0.4, oddsAmerican: -110 }
const m1 = mp.marketProbForPick(pick, ctx, { matchKeyForBet })
check("consensus: median of per-book DE-VIGGED fair probs across 3 two-sided books (=0.5 from the balanced median book)", m1.books === 3 && m1.p === 0.5)
check("SEV-1 seam: a side without over/under semantics gets NO market prob, named reason", mp.marketProbForPick({ ...pick, side: "yes" }, ctx, { matchKeyForBet }).reason === "no_over_under_semantics")
check("fail-open: no context ⇒ null + reason, never a guess", mp.marketProbForPick(pick, null, { matchKeyForBet }).reason === "no_context")

// ── shadow isolation + labels + kill switch ──
const picks = [pick, { player: "Test Guy", statFamily: "hits", side: "yes", line: 1, modelProb: 0.3, oddsAmerican: 200 }]
const before = JSON.stringify(picks)
const tap1 = mp.shadowTap(picks, ctx, { matchKeyForBet }, { slate: "2026-08-16" })
check("BYTE-IDENTICAL serve: the tap mutates nothing (deep-compare before/after)", JSON.stringify(picks) === before && tap1.logged === 2)
const shadowLines = fs.readFileSync(process.env.MARKET_PRIOR_SHADOW_PATH, "utf8").trim().split("\n").map((x) => JSON.parse(x))
check("shadow rows: blended entry carries pModel/pMarket/pFinal/w/provenance; w=1 no-support ⇒ pFinal = pMarket exactly",
  shadowLines[0].label === "blended_shadow" && shadowLines[0].pMarket === 0.5 && shadowLines[0].w === 1 && shadowLines[0].pFinal === 0.5 && /pure market/.test(shadowLines[0].wSource))
check("fail-open label rides the row: yes-side leg logs model_only — no market consensus, pFinal = pModel",
  /model_only — no market consensus/.test(shadowLines[1].label) && shadowLines[1].pFinal === 0.3 && tap1.modelOnly === 1)
process.env.MARKET_PRIOR_OFF = "1"
const tap2 = mp.shadowTap(picks, ctx, { matchKeyForBet }, { slate: "2026-08-16" })
delete process.env.MARKET_PRIOR_OFF
check("kill switch: MARKET_PRIOR_OFF=1 ⇒ tap disabled, zero rows appended (spec §5)",
  tap2.killed === true && fs.readFileSync(process.env.MARKET_PRIOR_SHADOW_PATH, "utf8").trim().split("\n").length === 2)

// ── forward-only fit ──
const tmpT = fs.mkdtempSync(path.join(os.tmpdir(), "mpt-"))
const mkRows = (fam, mk) => Array.from({ length: 300 }, (_, i) => { const y = i < 150 ? 1 : 0; return { statFamily: fam, oddsAmerican: 300, result: y ? "win" : "loss", ...mk(y) } })
fs.writeFileSync(path.join(tmpT, "mlb_tracked_bets_2026-08-10.json"), JSON.stringify([
  ...mkRows("hits", (y) => ({ modelProb: 0.5, closeImpliedProb: y ? 0.99 : 0.01 })),   // market perfect ⇒ w→1
  ...mkRows("runs", (y) => ({ modelProb: y ? 0.99 : 0.01, closeImpliedProb: 0.5 })),   // model perfect ⇒ w→0
  ...Array.from({ length: 50 }, (_, i) => ({ statFamily: "ks", oddsAmerican: 300, result: "win", modelProb: 0.5, closeImpliedProb: 0.5 })), // under support
]))
const fit = mp.fitW({ asOf: "2026-08-16", trackingDir: tmpT })
check("fitW: grid min-Brier lands w=1 where the market is perfect, w=0 where the model is (exact)",
  fit.byFamilyBand["hits|plus_mid"].w === 1 && fit.byFamilyBand["runs|plus_mid"].w === 0 && fit.byFamilyBand["hits|plus_mid"].decided === 300)
check("under-support segment (<300) absent from the fit ⇒ runs pure-market w=1 via wFor", fit.byFamilyBand["ks|plus_mid"] === undefined && mp.wFor("ks", "plus_mid").w === 1)
let threw = null
try { mp.fitW({ asOf: "2026-08-01", trackingDir: tmpT }) } catch (e) { threw = String(e.message) }
check("FORWARD-ONLY: a backward asOf THROWS with the refusal named (spec §2)", threw != null && /backward fit/.test(threw) && /forward-only/.test(threw))
const wState = JSON.parse(fs.readFileSync(process.env.MARKET_PRIOR_W_PATH, "utf8"))
check("w history committed: current + history entries with asOf/decidedUsed provenance", wState.current.asOf === "2026-08-16" && wState.history.length === 1 && wState.current.decidedUsed === 650)

// ── era-rule pin: NO pipeline/scripts importer — the serve route only ──
const importers = []
const walk = (dir) => { for (const f of fs.readdirSync(path.join(ROOT, dir))) { const rel = path.join(dir, f); const full = path.join(ROOT, rel); const st = fs.statSync(full); if (st.isDirectory()) { if (!/node_modules/.test(f)) walk(rel) } else if (/\.js$/.test(f) && rel !== path.join("pipeline", "shared", "marketPrior.js") && !/^verify/.test(f) && /require\([^)]*marketPrior/.test(fs.readFileSync(full, "utf8"))) importers.push(rel.replace(/\\/g, "/")) } }
walk("pipeline"); walk("routes"); walk("scripts"); walk("ml")
check("ERA-RULE PIN: marketPrior is imported ONLY by the serve route — zero pipeline/scripts/ml importers, so p_market can never feed calibration inputs",
  importers.length === 1 && importers[0] === "routes/workstationRoutes.js")

// ── board flip ──
const gb = require("./graduationBoard")
const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), "mpb-"))
const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), "mpc-"))
fs.writeFileSync(path.join(tmpB, "market_prior_shadow.jsonl"), ['{"slate":"2026-08-16"}', '{"slate":"2026-08-17"}'].join("\n") + "\n")
const b1 = gb.buildBoard({ trackingDir: tmpB, configDir: tmpC }).rows.find((r) => r.key === "market_prob_prior")
const b0 = gb.buildBoard({ trackingDir: fs.mkdtempSync(path.join(os.tmpdir(), "mpe-")), configDir: tmpC }).rows.find((r) => r.key === "market_prob_prior")
check("board: shadow logging flips queued→CAGED w/ nights toward the 14-bar + the 3-bar unlock verbatim; no shadow ⇒ still queued",
  b1.status === "caged" && b1.examNights.have === 2 && b1.examNights.bar === 14 && /3 bars, conjunctive/.test(b1.unlock) && b0.status === "queued")

// ── source anchors ──
const wr = rd("routes/workstationRoutes.js")
check("tap at serve: byte-identical doctrine + never-blocks + reuses this request's contexts", /MARKET-PRIOR SHADOW TAP/.test(wr) && /BYTE-IDENTICAL/.test(wr) && /shadow never blocks serving/.test(wr))
check("scheduler: Sun 06:25 refit w/ dedupe + guarded commit of the w file", /last_mprior_fit_min/.test(rd("scripts/scheduler.sh")) && /market_prior_w\.json/.test(rd("scripts/scheduler.sh")) && /fit: market-prior w weekly/.test(rd("scripts/scheduler.sh")))
const chc = rd("scripts/componentHealthCheck.js")
check("component #26 market_prior: ONE component folding both §5 rails (20% model-only + 0.15 drift), registered before the write",
  /checkMarketPrior/.test(chc) && /"market_prior"/.test(chc) && />20% bar \(spec §5\)/.test(chc) && /drift >0\.15/.test(chc) && chc.indexOf("fs.writeFileSync(OUT") > chc.indexOf("checkMarketPrior()"))
const src = rd("pipeline/shared/marketPrior.js")
check("spec corrections documented at source: fit-corpus honesty (#1) + topology-has-no-origination-weights ⇒ median (#2)",
  /FIT-CORPUS HONESTY \(spec correction #1/.test(src) && /REPO CORRECTION #2/.test(src) && /median is the house consensus/.test(src))
check("matrix: verifyMarketPrior registered", /"verifyMarketPrior"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifyMarketPrior: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
