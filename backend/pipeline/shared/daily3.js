"use strict"

/**
 * daily3.js — THE DAILY 3 (2026-07-14, break-window Part 3). The engine's
 * track-record lens and the SEED OF THE FUTURE PUBLIC RECORD — integrity first:
 *
 *   LOCK: every slate day, the top 3 board picks lock at FIRST PITCH − 60min
 *   (the same /top-picks lens the operator sees — capped-last, calibrated-edge
 *   order). After lock the card is IMMUTABLE (write-once file; the module
 *   REFUSES to overwrite — same doctrine as settled rows, no retroactive edits
 *   ever). If the lock window was missed (process down), it locks as soon as
 *   possible BEFORE first pitch with lockLate=true stamped; once the first
 *   pitch passes unlocked, that day gets NO card (integrity over continuity —
 *   we never lock picks whose games started).
 *
 *   GRADE: the EXISTING nightly (runHistoricalGrade) tuple-joins each locked
 *   pick against its graded tracked row — W/L/Push/Void per GRADING_RULES.
 *   Results are write-once (results!=null ⇒ never regraded). Net units at flat
 *   $1: win ⇒ +american profit, loss ⇒ −1, push/void ⇒ 0.
 *
 *   Zero new grading surface — curation + persistence over existing pipes.
 */

const fs = require("fs")
const path = require("path")
const http = require("http")
const crypto = require("crypto")
const { currentSlateDateEt } = require("./slateDate")

// 2026-07-29 DAILY3-RAILS — env overrides exist for HERMETIC FIXTURES ONLY
// (verifyDaily3Rails); production always uses the canonical paths. Receipts
// live in docs/receipts (TRACKED — backend/runtime/* is gitignored, so a
// receipt there could never ride git history; the tamper-evident chain needs
// commits as its second clock).
const TRACKING = process.env.DAILY3_TRACKING_DIR || path.join(__dirname, "..", "..", "runtime", "tracking")
const RECEIPTS = process.env.DAILY3_RECEIPTS_DIR || path.join(__dirname, "..", "..", "..", "docs", "receipts")
// Cards locked before this slate predate the receipt system — they are shown
// LABELED "pre-receipt era" and NEVER backfilled with after-the-fact hashes
// (a retroactive receipt would be exactly the fabrication the chain exists to
// make impossible). BINDING per operator GO 2026-07-29.
const RAILS_EPOCH = "2026-07-29"
const fileFor = (slate) => path.join(TRACKING, `daily3_${slate}.json`)
const receiptFor = (slate) => path.join(RECEIPTS, `daily3_receipt_${slate}.md`)

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "")

// 2026-07-21 INSTRUMENT-REPAIR — void-on-scratch. A locked pick whose player
// never appeared is VOIDED by every book; without this rule one scratched
// player stalls the all-3-decided gate FOREVER (measured: 07-18/19 cards stuck
// on Goodman/Stephenson/Witt no-shows). Rule: twin still undecided AND the
// slate is ≥2 days old AND the canonical name-join says NO appearance that
// date ⇒ void (0u), settleNote'd. Join misses / cache absence ⇒ stays pending
// (never guess). Uses the season gamelog caches read-only via the ONE
// cross-source join (playerNameJoin).
let _scratchIdx = null
function _playedOnDate(player, family, date) {
  try {
    if (!_scratchIdx) {
      const { buildJoinIndex } = require("./playerNameJoin")
      const bat = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "data", "mlbBatterGameLogsSeason.json"), "utf8"))
      const pit = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "data", "mlbPitcherGameLogsSeason.json"), "utf8"))
      _scratchIdx = {
        bat: buildJoinIndex(Object.entries(bat.players || {}).map(([k, v]) => [v.fullName || k, (v.games || []).map((g) => String(g.date))])),
        pit: buildJoinIndex(Object.entries(pit.players || {}).map(([k, v]) => [v.fullName || k, (v.starts || []).map((g) => String(g.date))])),
      }
    }
    const { resolvePlayer } = require("./playerNameJoin")
    const idx = ["ks", "outs", "hitsAllowed", "walks", "earnedRuns"].includes(String(family)) ? _scratchIdx.pit : _scratchIdx.bat
    const dates = resolvePlayer(idx, player)
    if (!dates) return null // unknown — never guess
    // 2026-07-21 COVERAGE GUARD: trust "no row" only when the cache has SEEN
    // PAST the slate (the player's newest cached game > slate). Otherwise a
    // cache lag is indistinguishable from a scratch ⇒ unknown, stays pending.
    const newest = dates.reduce((a, b) => (b > a ? b : a), "")
    if (!(newest > String(date))) return null
    return dates.includes(String(date))
  } catch (_) { return null }
}

/**
 * First pitch (ms) of the slate; null when no games known.
 * PRIMARY: the slate's tracked_best file — written at slate build and KEEPS
 * started games (snapshot events drop a game once it begins — measured
 * 2026-07-14: 1 game on the slate, events[] empty post-start). Without this,
 * a mid-slate reboot on a multi-game day would see only unstarted games and
 * mistake game 2 for "first pitch" — locking late picks into the public
 * record (false-lock corner). FALLBACK: snapshot events (covers a missing
 * tracked_best pre-start).
 */
function firstPitchMs(slate) {
  const { slateDateForTimestamp } = require("./slateDate")
  const times = []
  const push = (raw) => {
    const t = new Date(raw || 0).getTime()
    if (Number.isFinite(t) && t > 0 && slateDateForTimestamp(t) === slate) times.push(t)
  }
  try {
    const tb = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_best_${slate}.json`), "utf8"))
    for (const e of tb?.entries || []) push(e?.gameTime)
  } catch (_) {}
  if (!times.length) {
    try {
      const wrap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "snapshot-mlb.json"), "utf8"))
      for (const e of wrap?.data?.events || []) push(e?.commence_time || e?.gameTime)
    } catch (_) {}
  }
  return times.length ? Math.min(...times) : null
}

// ── 2026-07-29 DAILY3-RAILS (R1 + R3 lock-side) ──────────────────────────────

/** One plain-English line from a served pick's reasoning blob (R3 lock-time
 * why). Null when nothing real exists — never a fabricated narrative. */
function whyLineFromReasoning(reasoning) {
  try {
    if (!reasoning || typeof reasoning !== "object") return null
    const parts = []
    if (reasoning.l5 && reasoning.l5.value != null) parts.push(`${reasoning.l5.label || "L5"} ${reasoning.l5.value}`)
    if (reasoning.opp && reasoning.opp.value) parts.push(`${reasoning.opp.label || "opp"}: ${reasoning.opp.value}`)
    if (reasoning.propSpec && reasoning.propSpec.value != null) parts.push(`${reasoning.propSpec.label || ""} ${reasoning.propSpec.value}`.trim())
    if (Array.isArray(reasoning.drivers) && reasoning.drivers[0]) parts.push(String(reasoning.drivers[0]))
    const line = parts.filter(Boolean).join(" · ").slice(0, 220)
    return line || null
  } catch (_) { return null }
}

function sha256File(fp) {
  return crypto.createHash("sha256").update(fs.readFileSync(fp)).digest("hex")
}

/** Newest existing receipt for a slate strictly BEFORE `slate` (chain parent). */
function _prevReceipt(slate, receiptsDir) {
  try {
    const fls = fs.readdirSync(receiptsDir)
      .filter((f) => /^daily3_receipt_\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .filter((f) => f.slice(15, 25) < String(slate))
      .sort()
    return fls.length ? path.join(receiptsDir, fls[fls.length - 1]) : null
  } catch (_) { return null }
}

/**
 * R1 — LOCK-TIME RECEIPT. Write-once, tamper-evident: hashes the card file's
 * exact bytes + the PREVIOUS receipt's bytes (GENESIS on the first) — editing
 * any past card or receipt breaks every later link. The receipt is the
 * automatable proof; the operator's Betstamp tap rides on it but is NEVER a
 * dependency (binding per operator GO). Failure here never blocks the lock —
 * it logs loudly and the daily3Receipt alarm goes RED.
 */
function writeLockReceipt(card, { trackingDir, receiptsDir } = {}) {
  const tDir = trackingDir || TRACKING
  const rDir = receiptsDir || RECEIPTS
  const rp = path.join(rDir, `daily3_receipt_${card.slate}.md`)
  if (fs.existsSync(rp)) return { skipped: "exists", path: rp } // write-once
  const cardPath = path.join(tDir, `daily3_${card.slate}.json`)
  const cardSha = sha256File(cardPath)
  const prevPath = _prevReceipt(card.slate, rDir)
  const prevSha = prevPath ? sha256File(prevPath) : "GENESIS"
  const et = (iso) => { try { return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour12: true }) + " ET" } catch (_) { return iso } }
  const pickLine = (p, i) => `${i + 1}. ${p.player} ${String(p.side || "").toUpperCase()} ${p.line} ${p.statFamily} @ ${p.sportsbook} ${Number(p.odds) > 0 ? "+" : ""}${p.odds}`
  const md = [
    `# DAILY 3 LOCK RECEIPT — ${card.slate}`,
    ``,
    `- locked: ${et(card.lockedAt)} (${card.lockedAt})${card.lockLate ? " · lockLate" : ""}`,
    `- first pitch: ${et(card.firstPitchAt)} (${card.firstPitchAt})`,
    `- picks locked ${Math.round((new Date(card.firstPitchAt) - new Date(card.lockedAt)) / 60000)} min before first pitch`,
    ``,
    `## Picks (immutable at lock — write-once file, no retroactive edits ever)`,
    ...card.picks.map(pickLine),
    ``,
    `## Chain`,
    `- card sha256: ${cardSha}`,
    `- prev receipt sha256: ${prevSha}`,
    `- doctrine: each receipt hashes the previous — editing ANY past card or receipt breaks every later link. Pre-${RAILS_EPOCH} cards predate receipts and are never backfilled.`,
    ``,
    `## Post this (one tap)`,
    `THE DAILY 3 · ${card.slate} · locked ${et(card.lockedAt)} (T-60 rule)`,
    ...card.picks.map(pickLine),
    `record + full ledger (losses forward): /daily3 · receipt hash ${cardSha.slice(0, 12)}`,
    ``,
  ].join("\n")
  fs.mkdirSync(rDir, { recursive: true })
  const tmp = `${rp}.tmp.${process.pid}`
  fs.writeFileSync(tmp, md)
  fs.renameSync(tmp, rp)
  return { written: true, path: rp, cardSha, prevSha }
}

/**
 * Walk the receipt chain and recompute every prev-link. Returns
 * { ok, checked, breaks: [{slate, expected, actual}] }. Card-hash spot check
 * included when the card file still exists on disk (runtime files are
 * ephemeral relative to receipts — absence is NOT a break).
 */
function validateReceiptChain(receiptsDir) {
  const rDir = receiptsDir || RECEIPTS
  const out = { ok: true, checked: 0, breaks: [] }
  let fls = []
  try { fls = fs.readdirSync(rDir).filter((f) => /^daily3_receipt_\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort() } catch (_) { return out }
  for (let i = 0; i < fls.length; i++) {
    const fp = path.join(rDir, fls[i])
    const slate = fls[i].slice(15, 25)
    out.checked++
    const txt = fs.readFileSync(fp, "utf8")
    const stated = (txt.match(/prev receipt sha256: (\S+)/) || [])[1] || null
    const actual = i === 0 ? "GENESIS" : sha256File(path.join(rDir, fls[i - 1]))
    if (stated !== actual) { out.ok = false; out.breaks.push({ slate, expected: actual, actual: stated }) }
  }
  return out
}

/** Self-HTTP to the served lens — the EXACT ranking the operator sees. */
function fetchTopPicks(cb) {
  const req = http.get("http://127.0.0.1:4000/api/ws/top-picks?limit=10", { timeout: 8000 }, (res) => {
    let d = ""
    res.on("data", (c) => (d += c))
    res.on("end", () => { try { cb(null, JSON.parse(d)) } catch (e) { cb(e) } })
  })
  req.on("error", cb)
  req.on("timeout", () => { req.destroy(new Error("timeout")) })
}

/**
 * Called every minute by the server loop. No-ops fast in every state except the
 * one minute-window where locking is due. Never throws.
 */
function maybeLockDaily3() {
  try {
    const slate = currentSlateDateEt()
    const fp = fileFor(slate)
    if (fs.existsSync(fp)) return // IMMUTABLE — locked already, never rewrite
    const pitch = firstPitchMs(slate)
    if (!pitch) return // no games this slate (break/off-day) — no card, honestly
    const now = Date.now()
    if (now < pitch - 60 * 60000) return // before the lock window
    if (now >= pitch) return // first pitch passed unlocked — NO card today (integrity)
    fetchTopPicks((err, j) => {
      try {
        if (err || !j || !Array.isArray(j.picks) || j.picks.length < 3) {
          console.log(`[daily3] lock window open but lens unavailable/thin (${err?.message || (j?.picks?.length ?? 0) + " picks"}) — retrying next minute`)
          return
        }
        if (fs.existsSync(fp)) return // race guard
        const picks = j.picks.slice(0, 3).map((p) => ({
          player: p.player, statFamily: p.statFamily, side: p.side, line: p.line,
          sportsbook: p.sportsbook || p.book, odds: p.oddsAmerican ?? p.odds,
          modelProb: p.modelProb ?? null, tier: p.displayTier || p.tier || null,
          calibVersion: p.calibVersion ?? null, selectionPolicy: p.selectionPolicy ?? p.tierPolicy ?? null,
          // 2026-07-17 CARD-IDENTITY — the operator never looks up who a
          // player plays for. Additive; older locked cards render without.
          team: p.team ?? null, matchup: p.matchup ?? null, gameTime: p.gameTime ?? null,
          marketFormat: p.marketFormat ?? null,
          // 2026-07-29 DAILY3-RAILS R3 — lock-time WHY (from the served
          // reasoning blob): the record explains itself AT lock, not in
          // hindsight. Additive; null when nothing real exists.
          why: whyLineFromReasoning(p.reasoning),
        }))
        const card = {
          slate, lockedAt: new Date().toISOString(), firstPitchAt: new Date(pitch).toISOString(),
          lockLate: now > pitch - 55 * 60000, // locked inside the final 55min = the window was missed at its opening
          picks, results: null,
          _doc: "THE DAILY 3 — locked and IMMUTABLE at write; results write-once by the nightly. No retroactive edits ever (public-record seed).",
        }
        const tmp = `${fp}.tmp.${process.pid}`
        fs.writeFileSync(tmp, JSON.stringify(card, null, 2))
        fs.renameSync(tmp, fp)
        console.log(`[daily3] LOCKED ${slate} at ${card.lockedAt} (first pitch ${card.firstPitchAt}${card.lockLate ? ", lockLate" : ""}): ${picks.map((p) => `${p.player} ${p.side} ${p.line} ${p.statFamily}`).join(" | ")}`)
        // 2026-07-29 DAILY3-RAILS R1 — receipt rides the lock. Failure never
        // blocks the card; it logs loudly and the daily3Receipt alarm is RED.
        try {
          const rr = writeLockReceipt(card)
          console.log(`[daily3] RECEIPT ${rr.written ? "written" : rr.skipped} ${rr.path}${rr.cardSha ? ` (card ${rr.cardSha.slice(0, 12)} · prev ${String(rr.prevSha).slice(0, 12)})` : ""}`)
        } catch (re) { console.log(`[daily3] RECEIPT FAILED (card locked fine; alarm will flag): ${re?.message || re}`) }
      } catch (e) { console.log("[daily3] lock failed (non-fatal):", e?.message || e) }
    })
  } catch (e) { console.log("[daily3] tick failed (non-fatal):", e?.message || e) }
}

/** American odds → flat-$1 profit on a win. */
function unitProfit(odds) {
  const o = Number(odds)
  if (!Number.isFinite(o) || o === 0) return 0
  return o > 0 ? o / 100 : 100 / Math.abs(o)
}

/**
 * Grade a slate's card from its graded tracked file (tuple join). Write-once:
 * results already set ⇒ no-op. Called by runHistoricalGrade after bets grade.
 */
function gradeDaily3(slate) {
  try {
    const fp = fileFor(slate)
    if (!fs.existsSync(fp)) return { skipped: "no_card" }
    const card = JSON.parse(fs.readFileSync(fp, "utf8"))
    if (card.results) return { skipped: "already_graded" } // write-once
    let tracked = []
    try { tracked = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${slate}.json`), "utf8")) } catch (_) {}
    const results = []
    let net = 0, decided = 0
    for (const p of card.picks) {
      const t = (Array.isArray(tracked) ? tracked : []).find((r) => r &&
        norm(r.player) === norm(p.player) && String(r.statFamily) === String(p.statFamily) &&
        String(r.side).toLowerCase() === String(p.side).toLowerCase() && Number(r.line) === Number(p.line) &&
        norm(r.sportsbook) === norm(p.sportsbook))
      const res = t ? String(t.result || "pending").toLowerCase() : "pending"
      if (!["win", "loss", "push", "void"].includes(res)) {
        // 2026-07-21 void-on-scratch (see _playedOnDate doc above).
        // AGE FIX (07-19 stall root cause): the first cut anchored "2 days" at
        // noon-UTC of the slate date, so the slate+2 4 AM nightly read 1.83
        // days and slept through — a full extra day of stall. SLATE-KEY math
        // instead: the rule arms exactly when the CURRENT slate key is ≥2
        // calendar days past the card's slate (= the second grading night).
        const _keyMs = (k) => { const [y, m, d] = String(k).split("-").map(Number); return Date.UTC(y, m - 1, d, 12) }
        const slateAgeDays = Math.round((_keyMs(currentSlateDateEt()) - _keyMs(slate)) / 86400000)
        if (slateAgeDays >= 2 && _playedOnDate(p.player, p.statFamily, slate) === false) {
          results.push({ ...p, result: "void", units: 0, settleNote: `no appearance on ${slate} — voided per book behavior (scratch rule 2026-07-21)` })
          continue
        }
        results.push({ ...p, result: "pending" }); continue
      }
      decided += res === "win" || res === "loss" ? 1 : 0
      const units = res === "win" ? unitProfit(p.odds) : res === "loss" ? -1 : 0
      net += units
      results.push({ ...p, result: res, actualValue: t?.actualValue ?? null, units: Math.round(units * 100) / 100 })
    }
    if (results.some((r) => r.result === "pending")) return { skipped: "picks_still_pending" } // grade only when complete
    card.results = results
    card.netUnits = Math.round(net * 100) / 100
    card.gradedAt = new Date().toISOString()
    const tmp = `${fp}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(card, null, 2))
    fs.renameSync(tmp, fp)
    console.log(`[daily3] GRADED ${slate}: ${results.map((r) => r.result).join("/")} net ${card.netUnits > 0 ? "+" : ""}${card.netUnits}u`)
    return { graded: true, netUnits: card.netUnits }
  } catch (e) { return { error: String(e?.message || e) } }
}

/** Read API for the route: today's card + full history + honest aggregates. */
function readDaily3() {
  const files = fs.existsSync(TRACKING) ? fs.readdirSync(TRACKING).filter((f) => /^daily3_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse() : []
  const history = []
  for (const f of files) { try { history.push(JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8"))) } catch (_) {} }
  const today = currentSlateDateEt()
  const todayCard = history.find((c) => c.slate === today) || null
  let wins = 0, losses = 0, pushes = 0, net = 0, days = 0
  for (const c of history) {
    if (!c.results) continue
    days++
    for (const r of c.results) {
      if (r.result === "win") wins++
      else if (r.result === "loss") losses++
      else pushes++
    }
    net += Number(c.netUnits) || 0
  }
  const decided = wins + losses
  return {
    today: todayCard,
    todaySlate: today,
    firstPitchAt: todayCard ? todayCard.firstPitchAt : (firstPitchMs(today) ? new Date(firstPitchMs(today)).toISOString() : null),
    history: history.slice(0, 60),
    record: {
      days, wins, losses, pushes, decided,
      winRate: decided ? Math.round((wins / decided) * 1000) / 10 : null,
      netUnits: Math.round(net * 100) / 100,
      smallSample: decided < 30,
      honesty: decided < 30 ? `only ${decided} decided picks — win rate and units are not yet meaningful (needs ~30+)` : null,
    },
  }
}

/**
 * 2026-07-29 DAILY3-RAILS R2 — the losses-forward public payload. Read-only
 * over daily3_*.json + receipts + critic_<slate>.json. Serves NOTHING from
 * the personal ledger (no dollars, no books-linked identity) — picks, odds,
 * flat-$1 results, lock provenance, process notes. The FULL record, newest
 * first, every loss as loud as every win. SELL-GATE: a standing proving-phase
 * line ships in the payload; nothing here sells anything.
 */
function buildDaily3PublicPayload({ trackingDir, receiptsDir, criticDir } = {}) {
  const tDir = trackingDir || TRACKING
  const rDir = receiptsDir || RECEIPTS
  const cDir = criticDir || tDir
  const files = fs.existsSync(tDir) ? fs.readdirSync(tDir).filter((f) => /^daily3_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse() : []
  const cards = []
  let wins = 0, losses = 0, pushes = 0, net = 0, gradedDays = 0
  for (const f of files) {
    let c = null
    try { c = JSON.parse(fs.readFileSync(path.join(tDir, f), "utf8")) } catch (_) { continue }
    const rp = path.join(rDir, `daily3_receipt_${c.slate}.md`)
    let receipt
    if (fs.existsSync(rp)) {
      let txt = ""
      try { txt = fs.readFileSync(rp, "utf8") } catch (_) {}
      receipt = {
        era: "receipted",
        cardSha: (txt.match(/card sha256: (\S+)/) || [])[1] || null,
        prevSha: (txt.match(/prev receipt sha256: (\S+)/) || [])[1] || null,
      }
    } else {
      receipt = { era: c.slate < RAILS_EPOCH ? "pre-receipt" : "missing", cardSha: null, prevSha: null }
    }
    let critic = null
    try {
      const cr = JSON.parse(fs.readFileSync(path.join(cDir, `critic_${c.slate}.json`), "utf8"))
      const topReasons = Object.entries(cr.missedWinners?.byReason || {}).sort((a, b) => b[1] - a[1]).slice(0, 2)
      critic = {
        missedWinnerUnits: cr.missedWinners?.unitsAtFlat$1 ?? null,
        topDropReasons: topReasons.map(([k, v]) => `${k}: ${v}`),
        ceilingPct: cr.ceilingAudit?.ratePct ?? null,
        note: "the nightly adversary's read of the whole slate — what the gates cost, not a victory lap",
      }
    } catch (_) {}
    if (c.results) {
      gradedDays++
      for (const r of c.results) {
        if (r.result === "win") wins++
        else if (r.result === "loss") losses++
        else pushes++
      }
      net += Number(c.netUnits) || 0
    }
    cards.push({
      slate: c.slate, lockedAt: c.lockedAt, firstPitchAt: c.firstPitchAt, lockLate: !!c.lockLate,
      gradedAt: c.gradedAt || null, netUnits: c.results ? (Number(c.netUnits) || 0) : null,
      picks: (c.picks || []).map((p) => ({ player: p.player, statFamily: p.statFamily, side: p.side, line: p.line, sportsbook: p.sportsbook, odds: p.odds, marketFormat: p.marketFormat ?? null, matchup: p.matchup ?? null, why: p.why ?? null })),
      results: c.results ? c.results.map((r) => ({ result: r.result, units: r.units ?? 0, actualValue: r.actualValue ?? null, settleNote: r.settleNote ?? null })) : null,
      receipt, critic,
    })
  }
  const decided = wins + losses
  return {
    doc: "THE DAILY 3 — full public record, losses forward. Locked T-60 before first pitch, write-once, graded by the nightly, receipt-chained. No highlight reel exists.",
    generatedAt: new Date().toISOString(),
    record: {
      gradedDays, wins, losses, pushes, decided,
      winRate: decided ? Math.round((wins / decided) * 1000) / 10 : null,
      netUnitsFlat$1: Math.round(net * 100) / 100,
      smallSample: decided < 30,
      honesty: decided < 30 ? `only ${decided} decided picks — win rate and units are not yet meaningful (needs ~30+)` : null,
    },
    sellGate: {
      proving: true,
      line: "PROVING PHASE — nothing is for sale here. The record must survive its 90-day CLV/ROI gate first; until then this page exists to be checked, not to convince.",
      decidedTarget: 300,
    },
    receiptChain: validateReceiptChain(rDir),
    railsEpoch: RAILS_EPOCH,
    cards,
  }
}

module.exports = { maybeLockDaily3, gradeDaily3, readDaily3, unitProfit, firstPitchMs, whyLineFromReasoning, writeLockReceipt, validateReceiptChain, sha256File, buildDaily3PublicPayload, RAILS_EPOCH }
