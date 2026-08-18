"use strict"
// verifyBetSlipDrawer — UX SUB-PACK priority one (2026-08-18): the PARLAY tab
// becomes the bottom bet-slip drawer. ONE slip authority (state.parlay and
// window._slipTray alias the SAME array), every + button feeds the drawer,
// Daily 3 + Lab tickets gain tap-to-bet day one, copy-legs + navigation-only
// homeUrl fallback covers books whose deep-links ship DISABLED, and the
// deeplink kill-switch doctrine is proven intact. FE parse + alias-safety +
// money-literal guards included (the String.replace $-corruption class).
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const fe = (() => { try { return fs.readFileSync(path.join(ROOT, "..", "frontend", "mobile", "index.html"), "utf8") } catch (_) { return "" } })()

// ── 1. ONE slip authority (alias, never a copy) ──
check("alias: window._slipTray = state.parlay (drawer IS the parlay array)",
  fe.includes("window._slipTray = state.parlay;") && /ONE slip authority/.test(fe))
check("alias safety: ZERO reassignments of either name anywhere (mutate-only doctrine stated at source)",
  (fe.match(/_slipTray\s*=\s*\[\]/g) || []).length === 0 && (fe.match(/state\.parlay\s*=\s*\[\]/g) || []).length === 0 &&
  fe.includes("state.parlay.length = 0; // mutate, never reassign"))
check("persistence: same key edge:parlay:v1 (legs survive the upgrade, zero migration) + boot bar render",
  fe.includes('const PARLAY_STORAGE_KEY = "edge:parlay:v1"') && /Boot: persisted slip legs surface immediately/.test(fe))

// ── 2. one add path ──
check("addLeg: 6-leg cap + deeplink fields preserved (betLink/betSid/eventId/marketKey) + persist + drawer bar + card re-render",
  fe.includes('if (state.parlay.length >= 6) { alert("Bet slip is full (6 legs max)"); return; }') &&
  fe.includes("betLink: c.betLink || null, betSid: c.betSid || null,") &&
  /saveParlay\(\);\n      if \(typeof _slipRenderBar === "function"\) _slipRenderBar\(\);\n      render\(\);\n    \}/.test(fe))
check("modal path delegates: _slipAdd calls addLeg (its old private push/dedupe body gone)",
  /window\._slipAdd = function \(\) \{[\s\S]{0,400}addLeg\(p, p\.sport \|\| "mlb"\);/.test(fe) &&
  !fe.includes('window._slipTray.push({ ...p, _key: key });'))

// ── 3. tap-to-bet everywhere ──
check("Daily 3: picks cached + pending rows get the + button, routed through addLeg",
  fe.includes("window._d3Cache = (j3.today && j3.today.picks) || []") &&
  fe.includes('(!res || res.result === "pending") ? `<button onclick="window._d3Add(${i})') &&
  /window\._d3Add = function \(i\) \{[\s\S]{0,300}addLeg\(/.test(fe))
check("Lab: tickets cached + pending (locked) tickets get the slip-legs button, all legs through addLeg",
  fe.includes("window._labCache = (t && t.tickets) || []") &&
  fe.includes('${k.result === "pending" ? `<button onclick="window._labAdd(${ti})') &&
  /window\._labAdd = function \(ti\) \{[\s\S]{0,400}for \(const l of t\.legs\) addLeg\(/.test(fe))
check("GAMES rows already fed the legacy array (candForAdd/stash) — consolidation carries them to the drawer with no per-site rewires",
  fe.includes("const candForAdd = {") && fe.includes("state._gameViewStash[stashKey] = candForAdd;"))

// ── 4. PARLAY tab retired ──
check("tab button GONE, retirement comment present, renderParlay kept DORMANT (games-browser precedent), stray routes get the drawer",
  !/data-sport="parlay">PARLAY/.test(fe) && /PARLAY tab RETIRED/.test(fe) &&
  /function renderParlay\(main\)/.test(fe) && /renderParlay\(main\); \/\/ DORMANT view/.test(fe))

// ── 5. copy-legs + navigation-only home link ──
check("copy-legs: plain-text slip via clipboard API with textarea fallback for older iOS",
  /window\._slipCopyLegs = function/.test(fe) && /navigator\.clipboard\.writeText/.test(fe) && /_slipCopyFallback/.test(fe) && /document\.execCommand\("copy"\)/.test(fe))
check("panel: copy button renders in BOTH states (primary when no compose link, secondary beside one)",
  (fe.match(/window\._slipCopyLegs\(this\)/g) || []).length === 2)
check("home link: same-book only, reads matrix homeUrl, absent field = no link (never invented in FE)",
  /function _slipHomeAnchor\(legs\)/.test(fe) && /if \(books\.length !== 1\) return "";/.test(fe) && /if \(!cfg \|\| !cfg\.homeUrl\) return "";/.test(fe))

// ── 6. deeplink kill-switch doctrine INTACT ──
const mx = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "deeplinkMatrix.json"), "utf8"))
check("matrix: homeUrl on all 6 books, navigation-only class documented in _doc, enabled flags untouched (all still shipped false)",
  ["fanduel", "draftkings", "betmgm", "hardrockbet", "betrivers", "fanatics"].every((k) => /^https:\/\//.test(String(mx.books[k]?.homeUrl))) &&
  /NAVIGATION-ONLY class/.test(mx._doc) && /cannot open a wrong slip/.test(mx._doc) &&
  Object.values(mx.books).every((b) => b.enabled === false))
check("kill-switches: single-leg anchors still require cfg.enabled; compose still requires enabled AND confirmed/verified multiStatus",
  fe.includes("if (!cfg || !cfg.enabled || !p.betLink) return \"\";") &&
  fe.includes('if (!cfg || !cfg.enabled || !["confirmed", "verified"].includes(String(cfg.multiStatus))) return "";'))

// ── 7. record path untouched ──
check("record: _slipRecord still posts mode parlay to /api/ws/place-bet and REFUSES to record without the book's real combined odds",
  fe.includes('mode: "parlay",') && /Enter the combined odds YOUR book shows on the slip/.test(fe))

// ── 8. FE integrity ──
let parses = true
try { for (const m of fe.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]) } catch (_) { parses = false }
check("FE inline script parses (new Function)", parses && fe.length > 100000)
check("money literals intact — the $-corruption class stays dead (exactly one $${b.stake} and one $${b.toWin})",
  fe.split("$${b.stake}").length - 1 === 1 && fe.split("$${b.toWin}").length - 1 === 1)

console.log(`\nverifyBetSlipDrawer: ${pass}/${pass + fail} checks passed`)
if (fail) { console.log("FAILURES:"); for (const f of failures) console.log("  ✗ " + f); process.exit(1) }
