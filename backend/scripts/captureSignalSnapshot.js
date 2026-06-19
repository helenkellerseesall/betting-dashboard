#!/usr/bin/env node
"use strict"
/**
 * captureSignalSnapshot.js — FORWARD-ONLY signal capture (2026-06-18, CB; #31 primary deliverable).
 *
 * Stamps the AS-OF-BET-TIME staging-signal values onto each tracked bet into a SEPARATE per-slate
 * sidecar keyed by bet id. Run DAILY at slate time → each signal_capture_<slate>.json is the
 * point-in-time record for that day's bets (written once, never back-filled) → NO LOOKAHEAD.
 *
 * FREEZE-SAFE / ADDITIVE: does NOT touch tracked_bet scoring fields or any scored path (same pattern
 * as docket #3 context persistence). Reads the day's mlb_tracked_bets + the staging files; writes a
 * NEW sidecar with ZERO live consumer. Nothing wired.
 *
 * Signals stamped per bet (anti-fab: missing → null):
 *   batter props (hits/totalBases/hr/rbis/runs): statcastQuality[player] + airDensity[eventId]
 *     + opposingPitcherFip (the same-event pitcher-prop player on the OTHER team → pitcherFip)
 *   pitcher props (ks/outs/earnedRuns): pitcherFip[player]
 *
 *   node backend/scripts/captureSignalSnapshot.js [slateDate]   (default = currentSlateDateEt)
 */
const fs = require("fs"), path = require("path")
const normalizeName = require("../utils/normalizeName")
const { currentSlateDateEt, slateDateForTimestamp } = require("../pipeline/shared/slateDate")

// Data/tracking dirs overridable for isolated testing (fresh-vs-stale proof points them at /tmp).
const DATA = process.env.SIGNAL_CAPTURE_DATA_DIR || path.join(__dirname, "..", "data")
const TRACKING = process.env.SIGNAL_CAPTURE_TRACKING_DIR || path.join(__dirname, "..", "runtime", "tracking")
const SLATE = process.argv[2] || currentSlateDateEt()
const OUT = path.join(TRACKING, `signal_capture_${SLATE}.json`)
const BATTER_FAMS = new Set(["hits", "totalBases", "hr", "rbis", "runs"])
const PITCHER_FAMS = new Set(["ks", "outs", "earnedRuns"])

const key = (n) => normalizeName(String(n || ""))
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return null } }
const pick = (o, fields) => { if (!o) return null; const r = {}; let any = false; for (const f of fields) { r[f] = o[f] ?? null; if (r[f] != null) any = true } return any ? r : null }

function main() {
  const betsFile = path.join(TRACKING, `mlb_tracked_bets_${SLATE}.json`)
  // Graceful no-op (exit 0) when there are no tracked bets yet / empty slate (off-day or pre-slate)
  // — nothing to capture is HEALTHY, not an error; must NOT crash the scheduler chain.
  if (!fs.existsSync(betsFile)) { console.log(`[signal-capture] no tracked-bets file for slate ${SLATE} (empty slate / pre-slate) — no-op.`); process.exit(0) }
  const bj = readJson(betsFile); const bets = Array.isArray(bj) ? bj : (bj?.bets || bj?.rows || [])
  if (!bets.length) { console.log(`[signal-capture] 0 tracked bets for slate ${SLATE} — no-op (nothing to capture).`); process.exit(0) }
  const statcast = readJson(path.join(DATA, "mlbStatcastQuality.json")) || {}
  const fip = readJson(path.join(DATA, "mlbPitcherFip.json")) || {}
  const air = readJson(path.join(DATA, "mlbAirDensity.json")) || {}
  console.log(`[signal-capture] slate ${SLATE} | bets ${bets.length} | statcast ${Object.keys(statcast).length} | fip ${Object.keys(fip).length} | air ${Object.keys(air).length}`)

  // STALENESS GUARD: a staging file is FRESH only if it was (re)written TODAY (ET) — i.e. the
  // derivation refreshed it this cycle. On a vendor 403 the derivation exits before writing, so its
  // mtime stays old → STALE → we must NOT stamp its day-old values as if they were as-of-bet.
  const TODAY = currentSlateDateEt()
  const stagingFresh = (fileName) => { try { return slateDateForTimestamp(fs.statSync(path.join(DATA, fileName)).mtimeMs) === TODAY } catch (_) { return false } }
  const fresh = { statcast: stagingFresh("mlbStatcastQuality.json"), fip: stagingFresh("mlbPitcherFip.json"), air: stagingFresh("mlbAirDensity.json") }
  console.log(`[signal-capture] staging freshness (today=${TODAY}): statcast=${fresh.statcast} fip=${fresh.fip} air=${fresh.air}`)
  const stamped = { statcast: 0, fip: 0, air: 0 }
  const staleSkipped = { statcast: 0, fip: 0, air: 0 }

  // Reconstruct probable pitcher per (eventId, team) from the pitcher-prop rows in this slate.
  const pitcherByEventTeam = {}   // eventId → { teamName → pitcherKey }
  for (const b of bets) {
    if (!PITCHER_FAMS.has(b.statFamily)) continue
    const e = b.eventId; if (!e) continue
    pitcherByEventTeam[e] = pitcherByEventTeam[e] || {}
    if (b.team) pitcherByEventTeam[e][b.team] = key(b.player)
  }
  const opposingPitcherKey = (b) => {
    const m = pitcherByEventTeam[b.eventId]; if (!m) return null
    for (const [team, pk] of Object.entries(m)) if (team !== b.team) return pk
    return null
  }

  const out = {}
  let stampedBatter = 0, stampedPitcher = 0
  for (const b of bets) {
    if (!b.id) continue
    const fam = b.statFamily
    const entry = { betId: b.id, player: b.player, eventId: b.eventId, statFamily: fam, side: b.side, line: b.line, capturedAt: new Date().toISOString(), signals: {} }
    if (BATTER_FAMS.has(fam)) {
      // statcast quality — only if fresh today; else stale-skip (null), never stamp stale.
      if (fresh.statcast) { const v = pick(statcast[key(b.player)], ["barrelPct", "hardHitPct", "xwoba", "avgExitVelocity"]); entry.signals.statcastQuality = v; if (v) stamped.statcast++ } else { entry.signals.statcastQuality = null; entry.signals._statcastStale = true; staleSkipped.statcast++ }
      if (fresh.air) { const v = pick(air[b.eventId], ["airDensity", "densityAltitudeFt", "elevationFt"]); entry.signals.airDensity = v; if (v) stamped.air++ } else { entry.signals.airDensity = null; entry.signals._airStale = true; staleSkipped.air++ }
      if (fresh.fip) { const opk = opposingPitcherKey(b); const v = opk ? pick(fip[opk], ["fip", "xfip", "siera", "xera"]) : null; entry.signals.opposingPitcherFip = v; if (v) stamped.fip++ } else { entry.signals.opposingPitcherFip = null; entry.signals._oppFipStale = true; staleSkipped.fip++ }
      stampedBatter++
    } else if (PITCHER_FAMS.has(fam)) {
      if (fresh.fip) { const v = pick(fip[key(b.player)], ["fip", "xfip", "siera", "xera", "lobPct", "hr9"]); entry.signals.pitcherFip = v; if (v) stamped.fip++ } else { entry.signals.pitcherFip = null; entry.signals._fipStale = true; staleSkipped.fip++ }
      stampedPitcher++
    } else continue
    out[b.id] = entry
  }

  const ids = Object.keys(out)   // bet ids only (computed BEFORE adding _meta)
  const anyFresh = fresh.statcast || fresh.fip || fresh.air
  // _meta = the authoritative freshness record the /status forward-capture check reads.
  out._meta = {
    capturedAt: new Date().toISOString(), slate: SLATE, today: TODAY,
    signalFreshness: fresh, stamped, staleSkipped,
    anyStale: staleSkipped.statcast > 0 || staleSkipped.fip > 0 || staleSkipped.air > 0,
    allStale: !anyFresh, betsStamped: ids.length,
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))

  const cov = (test) => ids.filter((id) => test(out[id])).length
  console.log(`[signal-capture] stamped ${ids.length} bets (batter ${stampedBatter}, pitcher ${stampedPitcher})`)
  console.log(`[signal-capture] FRESH stamps — statcastQuality ${stamped.statcast} · opp+pitcher FIP ${stamped.fip} · airDensity ${stamped.air}`)
  console.log(`[signal-capture] STALE-SKIPPED (not stamped) — statcast ${staleSkipped.statcast} · fip ${staleSkipped.fip} · air ${staleSkipped.air}`)
  const sample = ids.find((id) => out[id].signals.statcastQuality) || ids.find((id) => out[id].signals.pitcherFip) || ids[0]
  if (sample) console.log("[signal-capture] SAMPLE", JSON.stringify(out[sample], null, 1))
  console.log("[signal-capture] wrote", OUT, "— per-slate point-in-time sidecar, ZERO live consumer (forward-only, no lookahead)")
  if (!anyFresh) { console.error("[signal-capture] ALL signals STALE today — nothing fresh stamped; vendor refresh likely failed. (file written with _meta.allStale for /status)"); process.exit(1) }
}
main()
