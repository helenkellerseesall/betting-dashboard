# Betting dashboard contract

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