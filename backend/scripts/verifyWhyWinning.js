"use strict"
// verifyWhyWinning — WHY-RESTORATION + WHAT'S-WINNING pack (2026-08-19):
// (0) the per-pick WHY back on every surface (factors from fields already on
// picks; /daily3 additive enrichment; TONIGHT tap-through; modal upgrade),
// (1) the WHAT'S WINNING read-only aggregation (n + NET on every row, odds
// sanity gate, no silent caps), (2) Lab lock-vs-slip microcopy, (3) hr_parlay
// ticket class w/ band constraint + FIND-2 bestSingleBook grading.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }
const fe = rd(path.join("..", "frontend", "mobile", "index.html"))
const wr = rd("routes/workstationRoutes.js")
const lab = rd("scripts/longshotLab.js")

// ── (0) WHY restoration ──
check("/daily3 enriches TODAY's picks additively (tracked-row tuple join w/ book-less fallback, factor fields, displayBundle, reasoning, playerPropHistory) and never blocks the card",
  /WHY-RESTORATION \(pack item 0\)/.test(wr) && /FACTOR_KEYS = \["windDirectionTag"/.test(wr) &&
  /tupleEq\(b, p, true\)\) \|\| rows\.find\(\(b\) => tupleEq\(b, p, false\)/.test(wr) &&
  /assembleMlbPickDisplayBundle\(e\)/.test(wr) && /e\.reasoning = buildReasoning\(e, null\)/.test(wr) &&
  /the card never blocks on its why/.test(wr) && /why: null \} \/\/ honest null/.test(wr))
check("FE: plain-English factor lines from existing fields (wind/temp/park/platoon/lineup/totals/tags) — omit-not-fabricate stated",
  /function _whyFactorLines\(p\)/.test(fe) && /Wind \$\{escapeHtml\(_whyWind/.test(fe) && /Park HR factor/.test(fe) &&
  /Platoon edge — faces the opposite-hand pitcher/.test(fe) && /Omit-/.test(fe) && /never a placeholder/.test(fe))
check("FE: why-this-pick/book/price sentences composed only from fields on the pick",
  /function _whyLead\(p\)/.test(fe) && /Why this pick:<\/b> the model gives it/.test(fe) &&
  /Why \$\{escapeHtml\(bk\)\}/.test(fe) && /Why this price:/.test(fe))
check("modal renders lead + factors — every surface that opens it inherits (PICKS cards + TONIGHT rows)",
  /\$\{_whyLead\(p\)\}\n          \$\{_whyFactorLines\(p\)\}/.test(fe) && /window\._d3Why = function/.test(fe) &&
  /onclick="window\._d3Why\(\$\{i\}, this\)"/.test(fe) && /tap for why/.test(fe))
check("Lab legs: per-leg why (model vs market vs implied, priced source) — data already on the leg",
  /window\._labWhy = function/.test(fe) && /no two-sided market to lean on/.test(fe) && /why these legs ▸/.test(fe))

// ── (1) WHAT'S WINNING ──
check("route: read-only aggregation over the ONE graded-corpus reader + critic artifacts + lab gate; 10-min cache",
  /router\.get\("\/whats-winning"/.test(wr) && /_buildGradedPicks\("mlb", TRACKING_DIR\)/.test(wr) &&
  /critic_\\d\{4\}/.test(wr) && /lab_gate\.json/.test(wr) && /_wwCache/.test(wr))
check("route: American-odds sanity gate (|odds|>=100) COUNTED not silent — the +506u poisoned-segment class named at source",
  /Math\.abs\(am\) >= 100/.test(wr) && /droppedBadOdds\+\+/.test(wr) && /droppedBadOdds,/.test(wr) && /\+506u/.test(wr))
check("route: every served row carries n + NET + trend; floors stated in payload (minSegmentN, segmentsBelowFloor); doctrine line present",
  /winPct:/.test(wr) && /netUnits: \+s\.netUnits\.toFixed\(1\)/.test(wr) && /minSegmentN: MIN_SEG_N, segmentsBelowFloor: smallSegs/.test(wr) &&
  /Hindsight winners are not foresight bets/.test(wr))
check("route: watch segments show bar-DISTANCE (600-n more decided / needs NET>0 / needs LB), same LB90 math as the critic",
  /more decided picks of data/.test(wr) && /1\.2816 \* Math\.sqrt\(W\)/.test(wr))
check("corpus reader export is the additive ONE-authority reuse (comment at source)",
  /_buildGradedPicks exported 2026-08-19/.test(rd("pipeline/tracking/buildHitRateByTier.js")))
check("FE: full board view (winners + losers equally loud + watch w/ distance + refused control group) + TONIGHT entry card + ⋯ entry",
  /async function renderWhatsWinning\(main\)/.test(fe) && /Board segments that LOSE/.test(fe) && /shown just as loud/.test(fe) &&
  /this pool LOSING is the gates working/.test(fe) && /the pattern leaderboard ▸/.test(fe) &&
  /window\._moreGo\('winning'\)/.test(fe) && /sport === "winning"/.test(fe))

// ── (2) Lab microcopy ──
check("lock vs slip contradiction resolved: frozen-paper-record label + copy-legs-your-call caption (CA 01:3x wording)",
  /🔒 paper record — frozen at 5:40/.test(fe) && /copy legs to your slip/.test(fe) &&
  /copying legs is YOUR call — these are paper-test tickets, not graduated picks/.test(fe))

// ── (3) hr_parlay + FIND-2 ──
check("hr_parlay: calibration-era certification (calibVersion + finite modelProb + served tiers), cross-game via usedEvents, opposition assert",
  /String\(r\.statFamily\) === "hr"/.test(lab) && /r\.calibVersion && Number\.isFinite\(Number\(r\.modelProb\)\)/.test(lab) &&
  /hr is deliberately NOT in the G2 PASS map/.test(lab) && /oppositionTrapAssert\(L\)/.test(lab))
check("hr_parlay: 3-5 legs INSIDE dec 21..101 (+2000..+10000 — the operator's payout structure AND the doc-§2 drought band), two-pass fit-seeking build",
  /legs\.length >= 3 && dec >= 21 && dec <= 101/.test(lab) && /tryBuild\(hrPool\) \|\| tryBuild/.test(lab) &&
  /would leave the \+10000 ceiling/.test(lab))
check("hr_parlay: own band record in the gate + cited drought (price-band reuse, not invented numbers)",
  /hr_parlay: \{ nights: new Set\(\)/.test(lab) && /doc-§2 price band as experimental/.test(lab))
check("FIND-2: bestSingleBook computed for ALL ticket kinds; null when no book carries every leg (stated, never guessed)",
  /const bestSingleBookOf = \(legs\)/.test(lab) && /t\.bestSingleBook = bestSingleBookOf\(t\.legs\)/.test(lab) &&
  /null when no\n  \/\/ single book carries every leg/.test(lab.replace(/\r/g, "")) || /const bestSingleBookOf/.test(lab))
check("FIND-2: settle AND gate grade on bestSingleBook when present; locked-past tickets grade exactly as locked",
  /const gradeDec = \(t\.bestSingleBook/.test(lab) && /const gDec = \(t\.bestSingleBook/.test(lab) &&
  /their bestSingleBook is absent by construction/.test(lab) && /locked-past tickets keep their locked math/.test(lab))
check("FE: kind chips (HR PARLAY / LONG SHOT) + placeable single-book price shown beside the cross-book price",
  /HR PARLAY<\/span>/.test(fe) && /placeable at \$\{escapeHtml\(k\.bestSingleBook\.book\)\}/.test(fe))

// ── incident pack 2026-08-24 ──
const sch = rd("scripts/scheduler.sh")
const spr = rd("scripts/settleParlaysFromRecord.js")
check("(a) finals prefetch dates include every UNGRADED daily3 card (shared authority no longer gated on personal parlays)",
  /UNGRADED daily3 card/i.test(spr) && spr.includes("daily3_\\d{4}") && /if \(card && !card\.results && Array\.isArray\(card\.picks\)\) dates\.push/.test(spr))
check("(b) settlePrior accepts the rung authority's REAL {hit} shape (and legacy result)",
  /s\.hit === 1 \? "win" : s\.hit === 0 \? "loss" : "pending"/.test(lab) && /not \{result\}/.test(lab))
check("(c) daily3 lock-liveness: scheduler curls the serve lens every ~10 min in the 16-21 ET window (lock-on-read gets a guaranteed reader)",
  /daily3 liveness touch/.test(sch) && /-ge 16 \] && \[ "\$HOUR" -lt 21/.test(sch) && /MIN % 10/.test(sch) && /api\/ws\/daily3/.test(sch))
check("(d) stale-lock hygiene: clear_stale_git_locks (>10 min age-gated) defined once and called before ALL FIVE auto-commit sites",
  (sch.match(/clear_stale_git_locks/g) || []).length === 6 && /AGE" -gt 600/.test(sch) && /index\.lock/.test(sch) && /HEAD\.lock/.test(sch))
check("(e) hr_parlay: tier gate GONE (structurally empty — every hr row is LONGSHOT by odds class), positive post-blend edge in, absence stamps reason+funnel on the artifact",
  !/\["ELITE", "STRONG", "PLAYABLE"\]\.includes\(String\(r\.tier \|\| ""\)\.toUpperCase\(\)\) &&\n      r\.calibVersion/.test(lab) &&
  /hrPool = _hrBlend\.filter\(\(r\) => r\._edge > 0\)/.test(lab) && /hrParlayAbsent = \{ reason, funnel: hrFunnel \}/.test(lab) &&
  /hrParlayAbsent: hrParlayAbsent \|\| null/.test(lab))
check("(f) FE: honest-null bestSingleBook renders 'no single book carries all legs' instead of nothing",
  /no single book carries all legs — copy legs and shop it/.test(fe))

// ── integrity ──
let parses = true
try { for (const m of fe.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]) } catch (_) { parses = false }
check("FE parses; money literals census intact (2 stake + 1 toWin)",
  parses && fe.split("$${b.stake}").length - 1 === 2 && fe.split("$${b.toWin}").length - 1 === 1)

console.log(`\nverifyWhyWinning: ${pass}/${pass + fail} checks passed`)
if (fail) { console.log("FAILURES:"); for (const f of failures) console.log("  ✗ " + f); process.exit(1) }
