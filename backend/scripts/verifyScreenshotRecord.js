"use strict"
// verifyScreenshotRecord — E SCREENSHOT-RECORD (2026-07-10) fixture.
//   1. REUSE, never reimplement: the flow calls the EXISTING convertImageToJpeg
//      (iPhone HEIC/camera-roll reality) + /api/ws/screenshots/ocr (the
//      Claude-Vision parser the ANALYZE tab uses). No new OCR surface.
//   2. NEVER SILENTLY RECORDED: every OCR result renders an EDITABLE confirm
//      screen; recording happens ONLY from _srConfirm reading the edited
//      fields; failures instruct "fix the field above and confirm again".
//   3. SAME canonical cores: records via /api/ws/place-bet (single or
//      mode=parlay) — tuple stamping + validation + duplicate guards inherited.
//   4. PRIMARY path: the button leads MY BETS (populated + empty states);
//      card-button flow remains as fallback.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const fe = (() => { try { return fs.readFileSync(path.join(ROOT, "..", "frontend", "mobile", "index.html"), "utf8") } catch (_) { return "" } })()

check("reuses the existing image pipeline (convertImageToJpeg + /screenshots/ocr)", /convertImageToJpeg\(file, 1600, 0\.9\);[\s\S]{0,400}screenshots\/ocr/.test(fe) && (fe.match(/api\/ws\/screenshots\/ocr/g) || []).length >= 2)
check("OCR failure states honestly (no slip parsed ⇒ message, nothing recorded)", /Couldn't read a betting slip from this image/.test(fe))
check("EDITABLE confirm screen between OCR and record (player/stat/side/line/odds inputs per leg)", /id="sr-player-\$\{i\}"/.test(fe) && /id="sr-stat-\$\{i\}"/.test(fe) && /id="sr-odds-\$\{i\}"/.test(fe) && /Check every field against your slip — OCR can misread\. Nothing records until you confirm\./.test(fe))
check("recording reads the EDITED fields, not the raw OCR result", /player: document\.getElementById\(`sr-player-\$\{i\}`\)/.test(fe))
check("records via the canonical route only (single + mode=parlay)", (fe.match(/api\/ws\/place-bet/g) || []).length >= 4 && /mode: "parlay", sport: "mlb", \.\.\.common, odds: combined/.test(fe))
check("parlay requires the slip's combined odds; singles toggle offered on multi-leg", /Enter the combined odds from your slip/.test(fe) && /separate singles/.test(fe))
check("per-result honesty: stamps shown, warnings shown, errors demand re-confirm", /fix the field above and confirm again/.test(fe) && /stamped \$\{escapeHtml\(s2\.calibVersion\)\}/.test(fe))
check("PRIMARY path: button on MY BETS populated + empty states; CLI copy gone", (fe.match(/Record a bet from a slip screenshot/g) || []).length >= 2 && !/Log a bet via <code/.test(fe))
// ── E-FOLLOWUP-2 (2026-07-10 field-test round 2) ─────────────────────────────
const adapter = (() => { try { return fs.readFileSync(path.join(ROOT, "pipeline", "screenshots", "ocrAnthropicAdapter.js"), "utf8") } catch (_) { return "" } })()
check("adapter: single-leg odds rule (the operator's -110 miss class) in the prompt", /SINGLE-leg slip the one visible price is BOTH the leg's odds AND the ticket's odds/.test(adapter))
check("adapter: book FINGERPRINT cue table for all 6 books + honest confidence field", /identify by FINGERPRINT cues/.test(adapter) && /BetMGM: black\/gold theme/.test(adapter) && /sportsbookConfidence: "high"/.test(adapter))
check("adapter: placedAtDate + stake + toWin extracted; single-leg odds↔combined backfill in code", /placedAtDate: the date the bet was PLACED/.test(adapter) && /normalized\[0\]\.odds = combined/.test(adapter))
check("FE: editable bet-date field (slip timestamp → true bet date, default today)", /id="sr-date" type="date"/.test(fe) && /from the slip's timestamp/.test(fe))
check("FE: book is a DROPDOWN that never guesses (empty on low confidence, blocks empty confirm)", /— pick the book —/.test(fe) && /json\.sportsbookConfidence === "high" && json\.sportsbook/.test(fe) && /Pick the book — the slip's fingerprint wasn't a confident match/.test(fe))
check("FE: cross-date duplicate → loud warning + explicit 'Record anyway' (force), never silent", /possible_duplicate/.test(fe) && /Record anyway — it's a second ticket/.test(fe) && /window\._srState\.force=true/.test(fe))
check("FE: stake prefills from the parsed slip", /value="\$\{s\.stake \?\? 1\}"/.test(fe))
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE inline scripts parse${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

console.log(`verifyScreenshotRecord: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
