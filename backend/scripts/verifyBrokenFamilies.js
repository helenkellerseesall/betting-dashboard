"use strict"
// verifyBrokenFamilies — BROKEN-FAMILY CONTAINMENT (2026-08-18 addendum,
// serve-truth class): ONE evidence-cited authority (brokenFamilies.js) for
// families the model is proven wrong on (mlb rbis + outs), applied at the
// serve layer only. Pins: the authority's aliases + evidence provenance, the
// /top-picks drop + loud counter, the /games tier/confidence suppression with
// raw lines kept, the _laneFor stale-file override, the featured-surface drop,
// the FE BROKEN pill + note, and — critically — that NO write path (tier
// stamping, tracking, grading) reads the module. Lift condition: a
// recalibration ASK passes (CA-verified GO); this fixture then evolves with
// provenance, never silently.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// ── 1. the authority: aliases resolve exactly like live data + route norms ──
const BF = require("../pipeline/shared/brokenFamilies")
check("authority: live tracked_bets tokens hit — statFamily 'outs' and 'rbis' (shape pinned from real 8/17 rows)",
  BF.isBrokenFamily("mlb", "outs") && BF.isBrokenFamily("mlb", "rbis"))
check("authority: display/alt aliases hit — 'Pitcher Outs' (GAMES board fam), 'pitcher_outs', 'rbi', 'RBIs', 'batter_rbis'",
  BF.isBrokenFamily("mlb", "Pitcher Outs") && BF.isBrokenFamily("mlb", "pitcher_outs") &&
  BF.isBrokenFamily("mlb", "rbi") && BF.isBrokenFamily("mlb", "RBIs") && BF.isBrokenFamily("mlb", "batter_rbis"))
check("authority: NEVER over-matches — healthy families and other sports stay off",
  !BF.isBrokenFamily("mlb", "hits") && !BF.isBrokenFamily("mlb", "ks") && !BF.isBrokenFamily("mlb", "totalBases") &&
  !BF.isBrokenFamily("mlb", "hr") && !BF.isBrokenFamily("nba", "rebounds") && !BF.isBrokenFamily("", "") && !BF.isBrokenFamily("mlb", null))

// ── 2. evidence provenance: the numbers that justified containment, verbatim ──
const outsInfo = BF.brokenFamilyInfo("mlb", "outs")
check("outs evidence pins the REAL drift line (model 50.6% / realized 12.1% / gap 38.5pp / n=66) + the stale-lane ROI",
  outsInfo && /50\.6% \/ realized 12\.1%/.test(outsInfo.evidence) && /38\.5pp \(n=66\)/.test(outsInfo.evidence) &&
  /ROI −19\.3% \(n=128\)/.test(outsInfo.evidence) && /102\/136/.test(outsInfo.evidence))
const rbisInfo = BF.brokenFamilyInfo("mlb", "rbis")
check("rbis evidence pins step1 −11.9pp + lane ROI −19.7% + the measured emergent suppression (10,769/10,769 LONGSHOT)",
  rbisInfo && /−11\.9pp/.test(rbisInfo.evidence) && /ROI −19\.7% \(n=56\)/.test(rbisInfo.evidence) && /10,769\/10,769/.test(rbisInfo.evidence))
check("lift condition is the recalibration ASK on BOTH entries — never ad-hoc removal",
  /recalibration ASK passes/.test(outsInfo.until) && /recalibration ASK passes/.test(rbisInfo.until))
const stamp = BF.brokenFamilyStamp("mlb", "outs")
check("serve stamp shape: label BROKEN + do-not-bet tip + evidence + until (what the FE renders from)",
  stamp && stamp.label === "BROKEN" && /Do not bet/.test(stamp.tip) && /no confidence claim/i.test(stamp.tip) &&
  stamp.evidence === outsInfo.evidence && BF.brokenFamilyStamp("mlb", "hits") === null)

// ── 3. serve-layer wiring: workstationRoutes ──
const wr = rd("routes/workstationRoutes.js")
check("route imports the ONE authority (never a local copy of the list)",
  /require\("\.\.\/pipeline\/shared\/brokenFamilies"\)/.test(wr))
check("/top-picks: broken families dropped pre-dedup with the LOUD counter (no silent caps) — drop sits AFTER tier filter, BEFORE book filter",
  /if \(isBrokenFamily\(sport, b\.statFamily\)\) \{ droppedBrokenFamily\+\+; continue \}/.test(wr) &&
  /let droppedBrokenFamily = 0/.test(wr) &&
  wr.indexOf('if (tier === "FADE" || tier === "LONGSHOT") continue') < wr.indexOf("droppedBrokenFamily++"))
check("/top-picks meta: droppedBrokenFamily surfaced in the response (observability, like droppedUnpurchasable)",
  /droppedBrokenFamily,\n/.test(wr) && wr.indexOf("droppedBrokenFamily,") > wr.indexOf("droppedStarted,"))
check("/games-browser mirror carries the same drop (dormant route kept consistent)",
  /BROKEN-FAMILY CONTAINMENT mirror/.test(wr) && /if \(isBrokenFamily\(sport, b\.statFamily\)\) continue/.test(wr))
check("_laneFor: authority OVERRIDES the stale lane_calibration.json (forced status broken + brokenAuthority evidence; file stats merged when present)",
  /const _bf = brokenFamilyInfo\(sport, fam\)/.test(wr) && /brokenAuthority:\s+\{ evidence: _bf\.evidence, until: _bf\.until \}/.test(wr) &&
  /laneStatusBadge\("broken"\)/.test(wr))
check("/games: tier + modelProb + edge join GATED on famBroken (raw lines/books still serve; familyProjection header dies with bestEdgeEntry)",
  /const famBroken = isBrokenFamily\(sport, fam\)/.test(wr) && /if \(m && !famBroken\) \{/.test(wr))
check("/state: stamp is ADDITIVE (c.brokenFamily only — existing fields untouched per the 2026-06-09 doctrine) + featured (recommendation surface) filtered",
  /const _bfs = brokenFamilyStamp\(sport, fam\)/.test(wr) && /if \(_bfs\) c\.brokenFamily = _bfs/.test(wr) &&
  /featured\.filter\(\(c\) => !c \|\| !c\.brokenFamily\)/.test(wr))

// ── 4. FE: BROKEN pill + suppressed confidence claims, backend-stamped only ──
const fe = rd(path.join("..", "frontend", "mobile", "index.html"))
check("FE: BROKEN pill replaces the tier pill for stamped rows (red, titled with the authority tip)",
  /const isBrokenFam = !!\(c && c\.brokenFamily\);/.test(fe) && /BROKEN<\/div>/.test(fe) &&
  fe.includes("${isBrokenFam") && fe.includes('`<div class="tier-pill ${tier}">${tierTxt}</div>${tierCapHtml}`'))
check("FE: edge bar (confidence claim) suppressed on broken rows; untouched elsewhere",
  fe.includes("${(ep != null && !isBrokenFam) ? `"))
check("FE: broken note rides buildNotes — FE never invents brokenness (backend-stamped only)",
  /model BROKEN on this family — no tier, no confidence claim\. Do not bet\./.test(fe) && /never decides brokenness itself/.test(fe))

// ── 5. RECORD PATH UNTOUCHED — the era-pin-style importer walk ──
// The record must keep accruing on these families or recalibration can never
// be proven. ONLY the serve route may import the authority.
const ALLOWED_IMPORTERS = new Set(["routes/workstationRoutes.js"])
function walk(dir, hits) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (name !== "node_modules" && name !== "_legacy" && name !== ".scratch") walk(p, hits) }
    else if (name.endsWith(".js") && p !== __filename) {
      const s = fs.readFileSync(p, "utf8")
      if (s.includes('require("../pipeline/shared/brokenFamilies")') || s.includes('require("./brokenFamilies")') ||
          s.includes('require("../shared/brokenFamilies")') || s.includes("brokenFamilies\")")) {
        const rel = path.relative(ROOT, p).split(path.sep).join("/")
        if (rel !== "pipeline/shared/brokenFamilies.js") hits.push(rel)
      }
    }
  }
}
const importers = []
walk(path.join(ROOT, "routes"), importers)
walk(path.join(ROOT, "pipeline"), importers)
walk(path.join(ROOT, "scripts"), importers)
const svr = rd("server.js"); if (/brokenFamilies/.test(svr)) importers.push("server.js")
const disallowed = importers.filter((r) => !ALLOWED_IMPORTERS.has(r))
check("importer walk: ONLY routes/workstationRoutes.js reads the authority — write/tier/grading paths proven clean (found: " + (importers.join(", ") || "none") + ")",
  disallowed.length === 0 && importers.includes("routes/workstationRoutes.js"))
check("tierForPlay (write-time tier stamping) does NOT read the authority — tracked_bets keep earning evidence",
  !/brokenFamilies/.test(rd("pipeline/mlb/buildMlbPropClusters.js")))

// ── 6. structural guards already covering these families stay intact ──
const slipAi = rd("pipeline/shared/buildSlipAi.js")
check("slips still exclude both families independently (SLIP_EXCLUDED_FAMILIES pre-dates this addendum; belt stays with suspenders)",
  /SLIP_EXCLUDED_FAMILIES = new Set\(\["rbis", "outs"\]\)/.test(slipAi))

console.log(`\nverifyBrokenFamilies: ${pass}/${pass + fail} checks passed`)
if (fail) { console.log("FAILURES:"); for (const f of failures) console.log("  ✗ " + f); process.exit(1) }
