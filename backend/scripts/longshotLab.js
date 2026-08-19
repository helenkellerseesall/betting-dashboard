#!/usr/bin/env node
"use strict"
/**
 * longshotLab.js — THE LONGSHOT LAB, nightly paper engine (2026-08-17,
 * standing queue; CC design docs/research/2026-08-15-longshot-lab.md §3,
 * CA triage ranked 1-3). PAPER ONLY — NOT BETTABLE until the printed bar
 * clears and the OPERATOR flips (never automatic).
 *
 * N=3 tickets/night: 2 WORKHORSE (cross-game 2-3 legs, Daily3-class certified
 * legs, ticket +500..+2000) + 1 EXPERIMENTAL (+2000..+10000 single ladder
 * rung, certified-zone only). Hard constraints, structurally enforced:
 *   - no leg without calibration-map support (family PASS/PASS_WITH_CORRECTION
 *     in config/g2_validation.json; rung legs additionally need a priced pFair
 *     = curve support) — the 1e-05 FANTASY class cannot be emitted;
 *   - NO same-game legs v1 + explicit opposition-trap assert (the one
 *     VALIDATED correlation is negative opposition — its money value is
 *     loss-avoidance in construction);
 *   - leg pricing = market-prior BLEND (join fixed f1eac7f) where the
 *     consensus resolves; model_only legs carry the label;
 *   - $1 paper stakes, write-once locks (Daily-3 grade), receipts ride git
 *     via the existing docs/receipts auto-commit, losses-forward surface.
 * Lock rule v1 (stated simplification): the nightly build runs at 17:40 ET
 * and only admits legs whose first pitch is ≥60 min after BUILD time —
 * T-60 satisfied by construction; a slate with no such games gets NO card,
 * honestly. Experimental legs join player→gameTime via the tracked board;
 * unknown gameTime = excluded (never guessed).
 * Env overrides (hermetic fixture): LAB_TRACKING_DIR, LAB_CONFIG_DIR,
 * LAB_RECEIPTS_DIR, LAB_NOW (ms), LAB_SKIP_MARKET (fixture: no snapshot ctx).
 */
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const ROOT = path.join(__dirname, "..")
const TRACKING = process.env.LAB_TRACKING_DIR || path.join(ROOT, "runtime", "tracking")
const CONFIG = process.env.LAB_CONFIG_DIR || path.join(ROOT, "config")
const RECEIPTS = process.env.LAB_RECEIPTS_DIR || path.join(ROOT, "..", "docs", "receipts")
const NOW = Number(process.env.LAB_NOW) || Date.now()
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")
const { buildJoinIndex, resolvePlayer } = require("../pipeline/shared/playerNameJoin")

const rdJ = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return d } }
const decOf = (am) => { const o = Number(am); return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o) }
const amOfDec = (d) => (d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1)))
const impliedOf = (am) => { const o = Number(am); return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100) }

// §2 drought benchmarks (computed in the design doc's probe; 300-ticket season)
const DROUGHT = {
  workhorse: { band: "+500–+2000", breakevenLongest: "31–117", edgedLongest: "27–101", note: "expected LONGEST losing streak in a 300-ticket season (doc §2) — a 100-straight run at +2000 is the EXPECTED worst stretch WITH a real edge" },
  experimental: { band: "+2000–+10000", breakevenLongest: "117–573", edgedLongest: "101–498", note: "droughts can exceed the whole season; a fair +10000 program has ~5% chance of ZERO wins in 300 (doc §2)" },
}
// §3 bar, verbatim — printed on every surface
const BAR = "per band: ≥90 nights AND ≥250 decided AND realized÷expected wins ≥0.85 (Poisson LB) AND flat units >0 AND CLV-positive share ≥ house bar AND the pricer gate cleared on the same window — flip = OPERATOR, never automatic"

function passFamilies() {
  const g2 = rdJ(path.join(CONFIG, "g2_validation.json"), {})
  return new Set(Object.entries(g2.verdicts || {}).filter(([, v]) => /^PASS/.test(String(v.verdict || v))).map(([f]) => f))
}

function marketCtx() {
  if (process.env.LAB_SKIP_MARKET === "1") return null
  // 2026-08-18: allowSlowBuild — the Lab is a batch lock, not a serve request
  // (the 250ms serve bailout silently un-priced 8/18's legs). Errors are no
  // longer swallowed to null-with-no-trace: the catch returns a named ctx.
  try { return require("../pipeline/shared/lineFreshness").buildRevalidationContext("mlb", { now: NOW, allowSlowBuild: true }) } catch (e) { return { ok: false, reason: "ctx_error: " + String(e && e.message || e), meta: {} } }
}

function blendLeg(row, ctx, mp, joins) {
  const pModel = Number(row.pFair ?? row.modelProb)
  const band = mp.bandOf(row.oddsAmerican)
  let pMarket = null, books = 0
  if (ctx && joins) { const m = mp.marketProbForPick(row, ctx, joins); pMarket = m.p; books = m.books || 0 }
  const { w, source } = mp.wFor(String(row.statFamily || row.family), band)
  const pFinal = pMarket != null ? mp.blend(pModel, pMarket, w) : pModel
  // band returned since 2026-08-18 (CA nit: printed undefined downstream)
  return { band, pModel: +pModel.toFixed(4), pMarket: pMarket != null ? +pMarket.toFixed(4) : null, books, w, wSource: source, pFinal: +pFinal.toFixed(4), priced: pMarket != null ? "blended" : "model_only" }
}

function oppositionTrapAssert(legs) {
  // no same-game legs at all (subsumes the trap) + the explicit named check
  const evs = legs.map((l) => l.eventId).filter(Boolean)
  if (new Set(evs).size !== evs.length) throw new Error("constraint violation: same-game legs")
  for (const a of legs) for (const b of legs) {
    if (a !== b && a.statFamily === "ks" && b.eventId && a.eventId && a.eventId === b.eventId) throw new Error("constraint violation: opposition trap")
  }
}

function buildTickets(slate) {
  const fams = passFamilies()
  const rows = rdJ(path.join(TRACKING, `mlb_tracked_bets_${slate}.json`), [])
  const mp = require("../pipeline/shared/marketPrior")
  let joins = null
  try { joins = { matchKeyForBet: require("./captureClosingLines").matchKeyForBet } } catch (_) {}
  const ctx = marketCtx()
  const cutoff = NOW + 60 * 60000
  const pool = rows.filter((r) =>
    ["ELITE", "STRONG", "PLAYABLE"].includes(String(r.tier || "").toUpperCase()) &&
    fams.has(String(r.statFamily)) &&
    Number.isFinite(Number(r.oddsAmerican)) && Number.isFinite(Number(r.modelProb)) &&
    ["over", "under"].includes(String(r.side || "").toLowerCase()) &&
    r.eventId && r.gameTime && Date.parse(r.gameTime) >= cutoff)
    .map((r) => ({ ...r, _b: blendLeg(r, ctx, mp, joins) }))
    .map((r) => ({ ...r, _edge: r._b.pFinal - impliedOf(r.oddsAmerican) }))
    .sort((a, b) => b._edge - a._edge)

  const mkLeg = (r) => ({ player: r.player, statFamily: r.statFamily, side: r.side, line: r.line, oddsAmerican: Number(r.oddsAmerican), sportsbook: r.sportsbook, eventId: r.eventId, gameTime: r.gameTime, marketKey: r.marketKey || null, ...r._b })
  const workhorse = []
  const usedLegs = new Set()
  for (let t = 0; t < 2; t++) {
    const legs = []
    const usedEvents = new Set()
    let dec = 1
    for (const r of pool) {
      const k = `${r.player}|${r.statFamily}|${r.side}|${r.line}`
      if (usedLegs.has(k) || usedEvents.has(r.eventId)) continue
      if (legs.length >= 3) break
      const nd = dec * decOf(r.oddsAmerican)
      if (legs.length >= 1 && nd > 21) continue // stay ≤ +2000
      legs.push(r); usedEvents.add(r.eventId); dec = nd
      if (legs.length >= 2 && dec >= 6) break // ≥ +500 with 2-3 legs
    }
    if (legs.length >= 2 && dec >= 6 && dec <= 21) {
      const L = legs.map(mkLeg)
      oppositionTrapAssert(L)
      const p = L.reduce((a, l) => a * l.pFinal, 1)
      workhorse.push({ kind: "workhorse", band: mp.bandOf(amOfDec(dec)), legs: L, oddsAmerican: amOfDec(dec), decimal: +dec.toFixed(2), pTicket: +p.toFixed(5), stake: 1, result: "pending" })
      legs.forEach((r) => usedLegs.add(`${r.player}|${r.statFamily}|${r.side}|${r.line}`))
    }
  }

  // experimental: a FLAGGED ladder rung (settleable by the rung ledger's ONE
  // settle authority), family PASS, priced pFair (curve support), +2000..+10000
  const gameTimeByPlayer = buildJoinIndex(rows.filter((r) => r.gameTime).map((r) => [r.player, r.gameTime]))
  const flags = []
  try {
    for (const ln of fs.readFileSync(path.join(TRACKING, "rung_flag_ledger.jsonl"), "utf8").split("\n").filter(Boolean)) {
      let e; try { e = JSON.parse(ln) } catch (_) { continue }
      if (e.type === "flag" && e.gameDate === slate && Number.isFinite(Number(e.pFair)) && fams.has(String(e.family)) && Number(e.oddsAmerican) >= 2000 && Number(e.oddsAmerican) <= 10000) flags.push(e)
    }
  } catch (_) {}
  const mpm = require("../pipeline/shared/marketPrior")
  let experimental = null
  for (const f of flags.map((f) => ({ ...f, _gt: resolvePlayer(gameTimeByPlayer, f.player) })).filter((f) => f._gt && Date.parse(f._gt) >= cutoff)
    .map((f) => ({ ...f, _ev: Number(f.pFair) * (decOf(f.oddsAmerican) - 1) - (1 - Number(f.pFair)) })).sort((a, b) => b._ev - a._ev)) {
    experimental = { kind: "experimental", band: mpm.bandOf(Number(f.oddsAmerican)), legs: [{ player: f.player, statFamily: f.family, side: "over", line: f.line, k: f.k, oddsAmerican: Number(f.oddsAmerican), sportsbook: f.book, flagId: f.id, gameTime: f._gt, pModel: +Number(f.pFair).toFixed(4), pMarket: null, w: 1, wSource: mpm.wFor(f.family, mpm.bandOf(f.oddsAmerican)).source, pFinal: +Number(f.pFair).toFixed(4), priced: "model_only" }], oddsAmerican: Number(f.oddsAmerican), decimal: +decOf(f.oddsAmerican).toFixed(2), pTicket: +Number(f.pFair).toFixed(5), stake: 1, result: "pending" }
    break
  }
  return { workhorse, experimental }
}

function settlePrior(gate) {
  // settle every unsettled lab ticket from graded twins / rung ledger settles — never guessed
  const settles = []
  const rungSettles = new Map()
  try { for (const ln of fs.readFileSync(path.join(TRACKING, "rung_flag_ledger.jsonl"), "utf8").split("\n").filter(Boolean)) { let e; try { e = JSON.parse(ln) } catch (_) { continue } if (e.type === "settle") rungSettles.set(e.id, e) } } catch (_) {}
  for (const f of fs.readdirSync(TRACKING).filter((x) => /^lab_tickets_\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    const p = path.join(TRACKING, f)
    const art = rdJ(p, null)
    if (!art || !Array.isArray(art.tickets)) continue
    let changed = false
    const rows = rdJ(path.join(TRACKING, `mlb_tracked_bets_${art.slate}.json`), [])
    const norm = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase()
    for (const t of art.tickets) {
      if (t.result !== "pending") continue
      const legRes = t.legs.map((l) => {
        if (l.flagId) { const s = rungSettles.get(l.flagId); return s ? String(s.result) : "pending" }
        const twin = rows.find((r) => norm(r.player) === norm(l.player) && r.statFamily === l.statFamily && String(r.side).toLowerCase() === String(l.side).toLowerCase() && Number(r.line) === Number(l.line) && ["win", "loss", "push", "void"].includes(String(r.result)))
        return twin ? String(twin.result) : "pending"
      })
      if (legRes.some((r) => r === "loss")) { t.result = "loss"; t.payout = 0 }
      else if (legRes.every((r) => r === "win")) { t.result = "win"; t.payout = +(t.stake * t.decimal).toFixed(2) }
      else if (legRes.every((r) => ["win", "void", "push"].includes(r)) && legRes.some((r) => r !== "win")) { t.result = "void_mixed_manual"; t.payout = null } // recompute needs per-leg prices — defer, never guess
      else continue
      t.legResults = legRes; t.settledAt = new Date(NOW).toISOString(); changed = true
      settles.push({ slate: art.slate, kind: t.kind, result: t.result, units: t.result === "win" ? +(t.stake * (t.decimal - 1)).toFixed(2) : t.result === "loss" ? -t.stake : 0 })
    }
    if (changed) fs.writeFileSync(p, JSON.stringify(art, null, 1))
  }
  if (settles.length) fs.appendFileSync(path.join(TRACKING, "lab_ledger.jsonl"), settles.map((s) => JSON.stringify({ ts: new Date(NOW).toISOString(), ...s })).join("\n") + "\n")
  return settles
}

function gateReadout() {
  const bands = { workhorse: { nights: new Set(), decided: 0, wins: 0, expWins: 0, units: 0 }, experimental: { nights: new Set(), decided: 0, wins: 0, expWins: 0, units: 0 } }
  for (const f of fs.readdirSync(TRACKING).filter((x) => /^lab_tickets_\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    const art = rdJ(path.join(TRACKING, f), null)
    if (!art) continue
    for (const t of art.tickets || []) {
      const b = bands[t.kind]; if (!b) continue
      b.nights.add(art.slate)
      if (["win", "loss"].includes(t.result)) { b.decided++; b.expWins += t.pTicket; if (t.result === "win") { b.wins++; b.units += t.stake * (t.decimal - 1) } else b.units -= t.stake }
    }
  }
  const out = {}
  for (const [k, b] of Object.entries(bands)) {
    const lb = b.expWins > 0 && b.wins > 0 ? +(((b.wins - 1.2816 * Math.sqrt(b.wins)) / b.expWins)).toFixed(2) : null
    out[k] = { nights: b.nights.size, decided: b.decided, wins: b.wins, expectedWins: +b.expWins.toFixed(2), poissonRatioLB: lb, flatUnits: +b.units.toFixed(2), bar: BAR, barMet: b.nights.size >= 90 && b.decided >= 250 && lb != null && lb >= 0.85 && b.units > 0 ? "pending CLV + pricer-gate checks — OPERATOR decides" : "NOT MET", drought: DROUGHT[k] }
  }
  return out
}

function writeReceipt(slate, art) {
  fs.mkdirSync(RECEIPTS, { recursive: true })
  const prev = fs.readdirSync(RECEIPTS).filter((f) => /^lab_receipt_/.test(f)).sort().pop()
  const prevHash = prev ? crypto.createHash("sha256").update(fs.readFileSync(path.join(RECEIPTS, prev))).digest("hex").slice(0, 16) : "genesis"
  const body = `# Longshot Lab lock receipt — ${slate}\nlockedAt: ${art.lockedAt}\nprev: ${prevHash}\ntickets:\n${art.tickets.map((t) => `- ${t.kind} ${t.oddsAmerican > 0 ? "+" : ""}${t.oddsAmerican} p=${t.pTicket} :: ${t.legs.map((l) => `${l.player} ${l.side ?? "over"} ${l.line} ${l.statFamily} @ ${l.sportsbook} (${l.priced})`).join(" × ")}\n`).join("")}paper-only · ${BAR}\n`
  fs.writeFileSync(path.join(RECEIPTS, `lab_receipt_${slate}.md`), body)
}

function main() {
  const slate = currentSlateDateEt()
  const settles = settlePrior()
  const artPath = path.join(TRACKING, `lab_tickets_${slate}.json`)
  if (fs.existsSync(artPath)) {
    console.log(`longshotLab [${slate}]: tickets already LOCKED (write-once) — ${settles.length} prior settle(s) this pass`)
  } else {
    const { workhorse, experimental } = buildTickets(slate)
    const tickets = [...workhorse, ...(experimental ? [experimental] : [])]
    if (!tickets.length) { console.log(`longshotLab [${slate}]: no eligible legs ≥T-60 with map support — NO CARD tonight (honest)`) }
    else {
      // marketCtx stamp (2026-08-18): the lock names its own pricing context —
      // a degraded night (bailout/error/absent snapshot) can never again read
      // as "the markets were thin" without evidence. ok/reason/rowCount/age.
      const _mc = marketCtx()
      const art = { slate, lockedAt: new Date(NOW).toISOString(), paperOnly: true, bar: BAR, marketCtx: _mc ? { ok: !!_mc.ok, reason: _mc.reason || null, rowCount: _mc.meta?.rowCount ?? null, ageMinutes: _mc.meta?.ageMinutes ?? null } : { ok: false, reason: "skipped_or_null", rowCount: null, ageMinutes: null }, tickets }
      fs.writeFileSync(artPath, JSON.stringify(art, null, 1))
      writeReceipt(slate, art)
      console.log(`longshotLab [${slate}]: LOCKED ${workhorse.length} workhorse + ${experimental ? 1 : 0} experimental (write-once; receipt chained)`)
      for (const t of tickets) console.log(`  ${t.kind}: ${t.oddsAmerican > 0 ? "+" : ""}${t.oddsAmerican} p=${t.pTicket} · ${t.legs.map((l) => `${l.player} ${l.statFamily} (${l.priced})`).join(" × ")}`)
    }
  }
  const gate = gateReadout()
  fs.writeFileSync(path.join(TRACKING, "lab_gate.json"), JSON.stringify({ generatedAt: new Date(NOW).toISOString(), gate }, null, 1))
  for (const [k, g] of Object.entries(gate)) console.log(`  gate[${k}]: ${g.nights}n/${g.decided}d/${g.wins}w exp=${g.expectedWins} LB=${g.poissonRatioLB} ${g.flatUnits}u — ${g.barMet}`)
}

if (require.main === module) main()
module.exports = { buildTickets, settlePrior, gateReadout, passFamilies, oppositionTrapAssert, DROUGHT, BAR }
