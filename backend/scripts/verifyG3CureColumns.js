"use strict"
// verifyG3CureColumns — G3-L3 pre-registered cure columns (2026-07-21).
// Claims:
//   1. PRE-REGISTRATION — blend w POOLED, fit walk-forward from SETTLED flags
//      only (grid, min Brier), per-family auto-trigger at ≥300 decided (CA ii);
//      dampening k=1 vs the all-book MEDIAN implied; opposition ρ consumed
//      from the COMMITTED verdicts JSON and ONLY while verdict === PASS
//      (PASS-only doctrine); unresolvable opponent ⇒ ABSTAIN (null, no flag).
//   2. SIGN — the conditional copula lowers batter probs vs strong-K
//      opposition (hit ⟺ low latent ⇒ zP = −Φ⁻¹(u)); unit-pinned both dirs.
//   3. LEDGER + GATES — flag rows carry all columns; legacy rows default
//      rawFlag=true; per-column tallies face the SAME bars + the
//      counterfactual kill bar (declined share of raw realized losses).
//   4. PAPER-ONLY — cures live in the shadow artifact + ledger; no serving,
//      no tracked writes (scanner doctrine unchanged).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const src = fs.readFileSync(path.join(ROOT, "scripts", "scanRungEv.js"), "utf8")

check("pre-reg: pooled walk-forward blend w (settled-only, grid min-Brier) + 300/family auto-trigger", /only ALREADY-SETTLED flags inform today's w/.test(src) && /w <= 1\.0001; w \+= 0\.05/.test(src) && /sub\.length >= 300/.test(src))
check("pre-reg: dampening k=1 vs all-book MEDIAN implied", /Math\.max\(margin, Math\.abs\(pFair - pMedian\)\) \/\/ k=1 pre-registered/.test(src) && /impList\[Math\.floor\(impList\.length \/ 2\)\]/.test(src))
// 2026-08-11 anchor evolved w/ the cure-C root fix (GO 63f24e4): abstain
// branches now TALLY their reason — the anchor pins abstain + count together.
check("pre-reg: opposition ρ from COMMITTED verdicts, PASS-only, abstain-on-unresolvable (tallied)", /oppo\.verdict === "PASS"/.test(src) && /if \(!OPPO_ON\) return null/.test(src) && /if \(!opp\) \{ oppoAbstains\.noOpp\+\+; return null \}/.test(src))
check("sign: zP = −Φ⁻¹(u) with the convention documented", /const zP = -invNormalCdf\(u\)/.test(src) && /hit ⟺ Z ≤ Φ⁻¹\(p\), i\.e\. LOW latent/.test(src))

// direction unit-pin through the real math
const { normalCdf, invNormalCdf } = require("../pipeline/shared/gaussianCopula")
const cond = (pFair, rho, u) => normalCdf((invNormalCdf(pFair) - rho * (-invNormalCdf(u))) / Math.sqrt(1 - rho * rho))
check("unit: strong-K opponent (u=0.9, ρ=−0.5) LOWERS a 50% batter rung; weak (u=0.1) RAISES it", cond(0.5, -0.5, 0.9) < 0.45 && cond(0.5, -0.5, 0.1) > 0.55)
check("unit: ρ=0 ⇒ conditioning is inert (pOppo === pFair)", Math.abs(cond(0.37, 0, 0.9) - 0.37) < 1e-9)

check("ledger: rows carry rawFlag + flagA/B/C + cure probs; any-column rungs recorded", /rawFlag: flagged, flagA, flagB, flagC/.test(src) && /if \(flagged \|\| flagA \|\| flagB \|\| flagC\)/.test(src))
check("gates: per-column tally w/ legacy rawFlag default-true + counterfactual kill bar", /e\.rawFlag !== false/.test(src) && /COUNTERFACTUAL KILL BAR/.test(src) && /declines majority of raw losses/.test(src) && /cureGates: \{ A: gateTally\("A"\), B: gateTally\("B"\), C: \{ \.\.\.gateTally\("C"\), abstainsTonight: \{ \.\.\.oppoAbstains \} \} \}/.test(src))
check("paper-only: no serving imports, no WRITES to tracked stores (team-truth READS are legitimate)", !/workstationRoutes|persistTracked/.test(src) && !/writeFileSync\([^)]*tracked_(bets|best)/.test(src) && !/writeFileSync\([^)]*mlb_picks/.test(src))

console.log(`verifyG3CureColumns: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
