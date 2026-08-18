"use strict"
// verifyUxDisplayPack — UX SUB-PACK landing 2 (2026-08-18): toWin-vs-payout
// truth on settled cards (D1 from the item-3 report), GRADES grouped with
// control-group framing, GAMES search + edges-only filter, ANALYZE parked
// behind the ⋯ menu, iOS-clean iteration 1 (navy base neutralized, semantic
// colors untouched). FE parse guard included.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const fe = (() => { try { return fs.readFileSync(path.join(ROOT, "..", "frontend", "mobile", "index.html"), "utf8") } catch (_) { return "" } })()

// ── 1. toWin truth (D1) ──
check("settled cards render BOOK TRUTH: pending keeps the → arrow, wins show paid-from-payout, push/void show stake returned, losses show −stake",
  /if \(res === "pending"\) return `<span[^`]*→ \$\$\{b\.toWin\}/.test(fe) &&
  /if \(res === "win"\) return `<span[^`]*paid \$\$\{Number\.isFinite\(pay\) \? pay : b\.toWin\}/.test(fe) &&
  /stake returned/.test(fe) && /−\$\$\{b\.stake\}/.test(fe))
check("the unconditional arrow is GONE (b62d25d6 class: card said $2.90, book paid $2.52) — provenance at source",
  !/<span style="font-size:13px;color:#34D399;font-family:ui-monospace,monospace;">→ \$\$\{b\.toWin\}<\/span>\n {14}<\/div>/.test(fe) &&
  /b62d25d6: card said \$2\.90, book paid \$2\.52/.test(fe))

// ── 2. GRADES grouping ──
check("GRADES: grouped WINS/LOSSES open + PENDING/PUSH-VOID collapsed, per-group counts, one extracted card fn",
  /const _gradeCard = \(p\) => \{/.test(fe) && /_grp\("✅ WINS", _wins, "#34D399", true\)/.test(fe) &&
  /_grp\("❌ LOSSES", _losses, "#F87171", true\)/.test(fe) && /_grp\("⏳ PENDING", _pend, "#FBBF24", false\)/.test(fe) &&
  /<details \$\{open \? "open" : ""\}/.test(fe))
check("GRADES: control-group framing verbatim — the model's test sheet, not the operator's money",
  /CONTROL GROUP — every pick the model graded last night, bet or not\./.test(fe) && /your real bets live in MY BETS/.test(fe))

// ── 3. GAMES search + edges-only ──
check("GAMES: search input (player/team/matchup, diacritic-folded) + edges-only toggle + honest hidden-count line",
  /id="games-search"/.test(fe) && /window\._gamesSearch\(this\.value\)/.test(fe) &&
  /normalize\("NFD"\)\.replace\(\/\[\\u0300-\\u036f\]\/g, ""\)/.test(fe) &&
  /window\._gamesEdgesToggle/.test(fe) && /hidden by \$\{_q \? "search" : ""\}/.test(fe))
check("GAMES: edges-only = ANY positive-edge joined prop (broken families can never qualify — edge suppressed server-side, stated at source)",
  /const _pHasEdge = \(p\) => Object\.values\(p\.propGroups \|\| \{\}\)\.some\(\(arr\) => \(arr \|\| \[\]\)\.some\(\(e\) => Number\(e\.edge\) > 0\)\)/.test(fe) &&
  /BROKEN-family row can never/.test(fe))
check("GAMES: debounced re-render restores the caret (iOS keyboard never lost)",
  /clearTimeout\(window\.__gamesSearchT\)/.test(fe) && /el\.setSelectionRange\(n, n\)/.test(fe))

// ── 4. ANALYZE parked ──
check("ANALYZE: tab button gone, parked in the ⋯ menu, menu routes through the normal render path",
  !/data-sport="analyze">ANALYZE/.test(fe) && /window\._moreMenu = function/.test(fe) &&
  /Analyze a slip screenshot/.test(fe) && /window\._moreGo\('analyze'\)/.test(fe) &&
  /state\.activeSport = sport;\n      render\(\);/.test(fe))
check("⋯ button excluded from the generic tab switcher (no dead active-state)",
  /if \(tab\.dataset\.sport === "__more"\) return;/.test(fe))

// ── 5. iOS-clean iteration 1 ──
check("navy base neutralized: #0A0E1A/#141828/#10182B/#1E3A8A all gone; graphite neutrals present; semantic colors untouched",
  !fe.includes("#0A0E1A") && !fe.includes("#141828") && !fe.includes("#10182B") && !fe.includes("#1E3A8A") &&
  fe.includes("#0B0C10") && fe.includes("#15161C") && fe.includes("#34D399") && fe.includes("#F87171"))

// ── 6. FE integrity ──
let parses = true
try { for (const m of fe.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]) } catch (_) { parses = false }
check("FE inline script parses", parses)

console.log(`\nverifyUxDisplayPack: ${pass}/${pass + fail} checks passed`)
if (fail) { console.log("FAILURES:"); for (const f of failures) console.log("  ✗ " + f); process.exit(1) }
