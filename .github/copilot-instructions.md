# Betting dashboard contract

> **⚠️ FORBIDDEN-LIST DIVERGENCE NOTICE (Authority-Reconciliation-Sweep R1-PASS-2, 2026-05-17)**
>
> The "Non-negotiable rules" list below contains a Cursor-era constraint — *"Do not reintroduce payout buckets, slipCards, or portfolio logic"* — that **actively contradicts the current repo state**: `frontend/.../PortfolioView.tsx` is active, bottleneck A-3 explicitly targets portfolio bettor-language, and candidate phase **BNSB-1D** is the portfolio language pass.
>
> **Canonical forbidden authority:** [`/DEFERRED_PHASES.md`](../DEFERRED_PHASES.md). Trust that file over the list below when the two conflict.
>
> The forbidden-list line above is preserved verbatim under additive-only doctrine for Cursor/Copilot agent backward-compatibility. **Treat the portfolio prohibition as SUPERSEDED.** All other "Non-negotiable rules" remain in force (no server restarts, minimal patches, do not touch upstream feed plumbing unless explicit, etc.).
>
> _Stamped 2026-05-17 by Authority-Reconciliation-Sweep R1-PASS-2 (R-16: forbidden-list cross-consistency)._
>
> ---

You are working on a sports-betting model in VS Code.

Non-negotiable rules:
- Do not run/start/restart servers or npm scripts.
- Modify only the files requested.
- Prefer minimal patches.
- Preserve current working behavior unless the task explicitly says otherwise.
- Never touch upstream feed plumbing unless the task explicitly requires it.
- Do not reintroduce payout buckets, slipCards, or portfolio logic.

Primary product goal:
- Produce a trustworthy nightly NBA board from the current live slate and current live book rows.

Required surfaced outputs:
- bestSingles
- bestLadders
- bestSpecials
- mustPlayCandidates
- bettingNow
- topCard

Acceptance rules for surfaced output:
- No surfaced row with playDecision containing avoid or fade.
- No surfaced special with null playDecision AND null decisionSummary.
- bettingNow rank 1 must be a core single or ladder.
- bettingNow max 1 special in top 3.
- Do not let invalid or stale specials surface.
- Do not collapse surfaced outputs to empty arrays.
- Preserve stable singles and ladders behavior while fixing specials.

Workflow:
- First identify the exact final runtime path affected.
- Then patch only that path.
- Add compact diagnostics proving the fix when debugging surfaced output.
- If a patch fails live verify, include:
  - what the patch intended to do
  - what the live verify actually showed
  - what path is ruled out
  - what exact path must be targeted next

Current known project truth:
- Generic prompt/rebalance tweaks have repeatedly hit the wrong path.
- Final runtime output assignment and final overwrite/re-rank are common failure points.
- For specials, validity and surfaced placement must be handled separately.