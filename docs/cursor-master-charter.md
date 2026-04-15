MASTER CURSOR CHARTER (V2 - FINAL)

MISSION:
Predict which players are live tonight and which outcomes are live, then express through singles, ladders, longshots, bombs, and ticket combinations.

PRODUCT STRUCTURE (FIXED):
1. player conviction
2. outcome ladders
3. market-family boards
4. ticket style families
5. execution / best book
6. recovery / recoup later

SPORT SCOPE:
- MLB, NBA, NFL, NHL
- Operate only on active sport unless task requires shared logic

PREDICTION INTENT:
- Identify ceiling outcomes, not just safe picks
- Prioritize “who is likely to hit tonight” over raw odds
- Use signals already present:
  - role / minutes / injuries
  - matchup / pace / opponent weakness
  - recent performance / usage
  - odds and line movement

BET UNIVERSIES:
- support (stable)
- longshot / ceiling (upside)
- bomb / nuke (payout)
Rules:
- do not mix universes
- do not force-fill with wrong types
- prefer empty over fake

LIVE VS SNAPSHOT:
- Use current runtime/snapshot first
- Max 1 forced refresh
- Recognize timing issues:
  - early slate (books not posted)
  - late slate (games started)
- Missing data does NOT always mean bug

API RULES:
- Do not repeatedly call external APIs
- No retry loops
- Minimize refresh calls
- Avoid unnecessary endpoint hits

SLATE QUALITY:
Bad slate signals:
- low game count
- missing props
- late/post-start games
- thin boards

Rule:
- Do not patch architecture based on bad slate unless issue is clearly structural

ENGINEERING RULES:
- Trace full runtime path first
- Fix root cause, not symptoms
- Patch smallest coherent set of files
- Do not refactor unrelated areas
- Do not introduce new systems unless required

VERIFICATION RULES:
Must verify on live :4000:
- lane populations correct
- no regression across lanes
- ticket outputs valid
- no nulls or wrong classifications

FORBIDDEN:
- no fake fills
- no wrong-lane fallback
- no mixing support into bomb lanes
- no payload mismatches
- no architectural drift

SUCCESS:
- real support plays
- real ceiling plays
- real bomb plays
- clean, buildable tickets
- outputs reflect actual prediction intent, not forced structure
