# /status Interactive Sport Toggle (Season-Switch v2) — Audit + Phase-1 Plan

**Author:** Claude-B [Cowork, Opus 4.8]
**Date:** 2026-06-14 ~18:43 ET (clock-checked)
**Mode:** AUDIT-FIRST (tight), read-only. Builds on Season-Switch-1A. FREEZE-SAFE — FE + one route + config write; NO scoring.

---

## 1. Write path — reuse the canonical, don't duplicate

- **Today:** `backend/scripts/sportToggle.js:39-52` reads `seasonsActive.json` (via `seasonGate.CONFIG_PATH`), validates the sport, sets `sports[sport]` + `updatedAt`, writes. The CLI owns the only write.
- **`seasonGate.js`** (`module.exports :107`) exposes `isSportEnabled, snapshot, CONFIG_PATH, KNOWN_SPORTS` — but **no write function**. It is the canonical season authority and is NOT on PRESERVED (Season-Switch-1A) → safe to extend.
- **Recommendation:** add `setSportEnabled(sport, enabled)` to `seasonGate.js` — validates (`KNOWN_SPORTS`), reads, flips one boolean, stamps `updatedAt`, writes atomically, returns the new `snapshot()`. Then **refactor `sportToggle.js` to call it** (delete its inline write) and the new route calls the SAME function. One write path, one validator (Law 1). No duplicated file-write.

## 2. SECURITY — public-tunnel write (must flag before building)

`server.js:19952` does `app.listen(PORT)` with **no host → binds all interfaces**; cloudflared proxies `edge.motel666.com` → `localhost:4000`. There is **no auth/token/CORS/origin guard anywhere** in `backend/routes` or `server.js` (grep clean). Consequences:

- A `POST /api/ws/status/season` would be **publicly reachable** over the tunnel.
- **A localhost/`req.ip` check does NOT work here** — because cloudflared proxies to `127.0.0.1:4000`, *every* tunnel request arrives at the backend as `127.0.0.1`. An IP/localhost guard would give false security (it cannot tell the operator from the public internet). Ruling this out explicitly.
- Precedent: `router.post("/snapshot") :1463` is ALREADY an unguarded public POST (writes `.scratch/last.txt`) — low risk. A season toggle is higher-meaning but still **low blast radius**: reversible, deletes nothing (kill-safety from Season-Switch-1A), and the operator sees the state on the card.

**Options (operator decides):**
- **(A) Shared token** — env `STATUS_WRITE_TOKEN` (set in the backend plist, CALIB_LINEAWARE pattern). Route requires header `x-status-token` to match; **token UNSET ⇒ route 403 (fail-closed)**. FE asks the operator once, stores in `sessionStorage`, sends on each POST. Real guard that works over the tunnel; one-time paste per browser session. **Recommended minimum.**
- **(B) Accept-as-personal** — no token; rely on the obscure hostname + reversibility + the existing `/snapshot` precedent. Frictionless (matches the "native iOS app feel" goal). Risk: anyone who learns `edge.motel666.com` could flip a sport (annoying, not damaging).
- **(C) ~~localhost/IP check~~** — ineffective behind the tunnel; do not use.

I recommend (A) as the default; (B) is defensible given the low blast radius — operator's call.

## 3. FE — iOS-style toggle in the Sports Active card

`frontend/status/index.html` already has `cardSportsActive` + `renderSportsActive(data)` (Season-Switch-1A) rendering per-sport tiles from `data.sportsActive.sports[sport]`. Extend the render to draw a real **iOS-style switch** (rounded pill track + sliding knob, CSS transition; green=on / grey=off). Behavior:
- MLB/NBA → interactive switches. NFL/NHL (`state==="no_scripts"`, no pipeline) → **dim + disabled** (can't meaningfully enable; avoids confusion).
- Click → `POST /api/ws/status/season {sport, enabled}` (+ token header if option A) → **optimistic flip** of the knob; on failure revert + toast; the 30s auto-refresh (`loadStatus`) reflects true server state. Pure CSS/JS, no deps. This is step 1 of the broader "native iOS look" vision.

## 4. Phase-1 plan

1. `seasonGate.js` — add `setSportEnabled(sport, enabled)` (canonical write) + export it.
2. `sportToggle.js` — refactor to call `setSportEnabled` (dedupe the inline write; CLI behavior unchanged, still prints the commit fence).
3. `statusRoute.js` — `router.post("/season", …)`: validate `{sport ∈ KNOWN_SPORTS, enabled:boolean}`; **token guard per option A** (or skip per B); call `seasonGate.setSportEnabled`; return `{ ok, sports }`. Phase-tagged.
4. `frontend/status/index.html` — iOS switch CSS + interactive `renderSportsActive` + `postSeasonToggle()`.
5. **No-restart behavior:** the route writes `seasonsActive.json`; `seasonGate`/scheduler/slate read it FRESH → a flip from the page takes effect within the scheduler's 30s tick, identical to the CLI. (Backend needs ONE `launchctl kickstart -k …backend` to load the new route code; toggles thereafter need no restart.)
6. **Freeze-guard / fixture:** no scoring touched (FE + config write only). Extend `verifySeasonGate.js` with: `setSportEnabled` round-trips the JSON (on→off→on, restores), rejects unknown sport / non-boolean. Keep matrix at 18 (extend the existing suite, no new one). A live-route test needs the express app → out of scope; the FE+route are verified by the operator clicking + the card reflecting (real-output operator verification).

**Freeze/PRESERVED:** seasonGate.js + statusRoute.js + index.html + sportToggle.js are all non-PRESERVED. No scoring, no R2/T2 path touched. Deploy = one backend kickstart (route code) outside PM-ET tipoff windows; toggling is pure data thereafter.

**Decisions for operator:** (a) security option A (token) vs B (accept-as-personal); (b) confirm NFL/NHL render disabled (no pipeline) vs interactive.

---

## 5. Build results (2026-06-14 — operator approved: option A token + NFL/NHL disabled)

Built: `seasonGate.setSportEnabled` (canonical write) + `sportToggle.js` refactored onto it; `statusRoute.js router.post("/season")` (token-guarded, fail-closed); FE iOS toggle + `postSeasonToggle()` in `index.html`; `verifySeasonGate` extended (29→37).

**Verified (real output):** node --check clean (seasonGate, sportToggle, statusRoute, verifySeasonGate); FE JS parses; `verifySeasonGate` 37/37 (incl. setSportEnabled round-trip, reject unknown-sport / non-boolean, route 403 on unset token, route 403 on mismatched token, config byte-identical after); full `runtime:verify` **18/18** (matrix unchanged — extended the existing suite). Config left intact (mlb ON, nba/nfl/nhl OFF).

**Security posture shipped:** token read per-request from `STATUS_WRITE_TOKEN`; unset OR mismatch ⇒ 403. The endpoint cannot ship open. Operator generates the token (`openssl rand -hex 16`) and sets it in the backend plist env, then reloads. FE prompts once per browser session (sessionStorage); a 403 clears the stored token so the next tap re-prompts.

**Deploy:** ONE `launchctl kickstart -k gui/$(id -u)/com.motel666.backend` to load the route — outside PM-ET tipoff windows. Operator verifies by setting the token, opening /status on the phone, tapping a switch, and seeing it flip + persist. No scoring touched; PRESERVED untouched.
