"use strict"

/**
 * lineFreshness.js — LINE-FRESHNESS AT SERVE (queued ASK 2026-07-28 19:40).
 *
 * Field case: Clement u1.5 served while BetMGM sold only u0.5 — the operator
 * nearly bought a line the app no longer sells. This module is the ONE
 * serve-time revalidation authority: every served card re-checks its
 * (player, family, side, line, book, marketKey) tuple against the FRESHEST
 * on-disk snapshot and comes back classified:
 *
 *   fresh         exact tuple present, implied-prob drift < PRICE_DRIFT_PP
 *   price_drift   exact tuple present, odds drifted ≥ PRICE_DRIFT_PP implied —
 *                 the card serves the CURRENT odds with a drift badge
 *   line_moved    exact tuple gone, same market exists at a DIFFERENT line —
 *                 the card serves the CURRENT line/odds ("was u1.5 −165") so
 *                 the exec-panel prefill records the tuple the book actually
 *                 sells (tuple-identity doctrine: the u0.5 bet joins u0.5 rows)
 *   suspended     tuple vanished from a FRESH snapshot (≤ SUSPENDED_MAX_AGE_MIN)
 *                 — deathbed warning, never silently served
 *   unknown_stale tuple vanished but the snapshot is TOO OLD to testify —
 *                 a stale snapshot cannot prove a market was pulled, so this
 *                 is an honest "can't confirm", NOT a suspended claim
 *   skipped       no usable snapshot / wrong slate / revalidation error —
 *                 served-but-labeled beats blocked (accepted risk in the ASK)
 *
 * JOIN AUTHORITY IS REUSED, NOT REINVENTED: the exact/loose tuple indexes and
 * the nearest-moved-line picker come from scripts/captureClosingLines.js —
 * the same machinery that stamps closing lines every 5 minutes during game
 * windows. One join authority; serve-time and close-capture can never drift.
 *
 * Events (line_moved / price_drift / suspended / error) append to
 * runtime/tracking/line_freshness_events.jsonl for the nightly critic and the
 * Sunday surface audit to re-measure (did serving moved lines cost or save
 * money?). Read-only over the snapshot; writes ONLY the events sidecar.
 *
 * Latency guard: the snapshot parse is cached by file mtime — a request pays
 * the parse only when the snapshot actually changed on disk. If context build
 * still exceeds BAILOUT_MS the caller gets ok:false and cards serve
 * stamped-stale instead of blocking (measured before landing: cold parse of a
 * 21k-row snapshot ≈ 400ms on the host, warm cache ≈ 0ms — the cache is the
 * difference between "fine" and "board latency").
 */

const fs = require("fs")
const path = require("path")

// ── join authority (REUSED from the close-capture engine) ────────────────────
const {
  buildPropIndex,
  matchKeyForBet,
  buildLooseIndex,
  looseKeyForBet,
  pickNearestMovedLine,
} = require("../../scripts/captureClosingLines")

const BACKEND = path.join(__dirname, "..", "..")
const SNAPSHOT_PATHS = {
  nba: path.join(BACKEND, "snapshot.json"),
  mlb: path.join(BACKEND, "snapshot-mlb.json"),
}
const DEFAULT_EVENTS_FILE = path.join(BACKEND, "runtime", "tracking", "line_freshness_events.jsonl")

// Thresholds (the ASK's numbers — change only with operator approval).
const PRICE_DRIFT_PP = 1.5        // implied-probability drift that earns a badge
const SUSPENDED_MAX_AGE_MIN = 15  // a snapshot older than this cannot testify "pulled"
const BAILOUT_MS = 250            // context build slower than this ⇒ stamped-stale serve

// ── math ─────────────────────────────────────────────────────────────────────
/** American odds → implied probability (vig-inclusive). null on garbage. */
function impliedFromAmerican(odds) {
  const o = Number(odds)
  if (!Number.isFinite(o) || o === 0) return null
  return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100)
}

// ── snapshot context (mtime-cached) ──────────────────────────────────────────
const _ctxCache = new Map() // sport → { mtimeMs, ctx }

/**
 * Build (or reuse) the revalidation context for a sport.
 * Returns { ok, reason?, exactIx?, looseIx?, meta } — meta always present:
 *   { snapshotPath, updatedAt, fileMtimeMs, ageMinutes, slateKey, rowCount, tookMs, cached }
 * ok:false ⇒ revalidation must be skipped (absent/empty/unparseable snapshot
 * or build exceeded BAILOUT_MS); cards still get the age stamp when known.
 */
function buildRevalidationContext(sport, { snapshotPath, now } = {}) {
  const t0 = Date.now()
  const nowMs = Number.isFinite(now) ? now : t0
  const sp = String(sport || "").toLowerCase()
  const file = snapshotPath || SNAPSHOT_PATHS[sp]
  const bare = (reason, extra = {}) => ({
    ok: false, reason,
    meta: { snapshotPath: file || null, updatedAt: null, fileMtimeMs: null, ageMinutes: null, slateKey: null, rowCount: 0, tookMs: Date.now() - t0, cached: false, ...extra },
  })
  if (!file) return bare("unknown_sport")

  let mtimeMs = null
  try { mtimeMs = fs.statSync(file).mtimeMs } catch (_) { return bare("snapshot_absent") }
  const ageMinutes = +(((nowMs - mtimeMs) / 60000).toFixed(1))

  const cacheKey = file // path-keyed so fixture paths never collide with live
  const hit = _ctxCache.get(cacheKey)
  if (hit && hit.mtimeMs === mtimeMs) {
    // Warm path: same indexes, FRESH meta (age moves with the clock). Copy —
    // never mutate the cached object under an earlier caller's feet.
    const c = hit.ctx
    return { ok: c.ok, exactIx: c.exactIx, looseIx: c.looseIx, meta: { ...c.meta, ageMinutes, tookMs: Date.now() - t0, cached: true } }
  }

  let wrap = null
  try { wrap = JSON.parse(fs.readFileSync(file, "utf8")) } catch (_) { return bare("snapshot_unreadable", { fileMtimeMs: mtimeMs, ageMinutes }) }
  const snap = (wrap && wrap.data) || wrap || {}
  const rows = Array.isArray(snap.rawProps) ? snap.rawProps
    : Array.isArray(snap.props) ? snap.props
    : Array.isArray(snap.rows) ? snap.rows
    : []
  if (!rows.length) return bare("snapshot_empty", { fileMtimeMs: mtimeMs, ageMinutes })

  const ctx = {
    ok: true,
    exactIx: buildPropIndex(rows),
    looseIx: buildLooseIndex(rows),
    meta: {
      snapshotPath: file,
      updatedAt: snap.updatedAt || snap.snapshotGeneratedAt || null,
      fileMtimeMs: mtimeMs,
      ageMinutes,
      slateKey: snap.snapshotSlateDateKey || null,
      rowCount: rows.length,
      tookMs: Date.now() - t0,
      cached: false,
    },
  }
  _ctxCache.set(cacheKey, { mtimeMs, ctx })
  if (ctx.meta.tookMs > BAILOUT_MS) {
    // Build succeeded but blew the budget — cache it (next request is warm and
    // FAST), but tell THIS caller to serve stamped-stale rather than continue
    // spending request time. Served-but-labeled beats blocked.
    return { ok: false, reason: "bailout_slow_build", meta: ctx.meta }
  }
  return ctx
}

/** Fixture/ops helper: drop the module cache (never needed in production). */
function _resetContextCache() { _ctxCache.clear() }

// ── per-pick revalidation ────────────────────────────────────────────────────
/**
 * Classify one served pick against a context from buildRevalidationContext.
 * PURE — never mutates the pick; the serve pass applies the verdict.
 * Returns { status, asOf, ageMinutes, current?, original?, driftPp?, reason? }.
 */
function revalidatePick(pick, ctx) {
  const meta = (ctx && ctx.meta) || {}
  const stamp = { asOf: meta.updatedAt || (meta.fileMtimeMs ? new Date(meta.fileMtimeMs).toISOString() : null), ageMinutes: meta.ageMinutes ?? null }
  if (!ctx || !ctx.ok) return { status: "skipped", reason: (ctx && ctx.reason) || "no_context", ...stamp }

  const origOdds = Number(pick.oddsAmerican ?? pick.odds)
  const original = { line: pick.line ?? null, odds: Number.isFinite(origOdds) ? origOdds : null }

  const exact = ctx.exactIx.get(matchKeyForBet(pick))
  if (exact) {
    const curOdds = Number(exact.odds ?? exact.oddsAmerican)
    const a = impliedFromAmerican(curOdds), b = impliedFromAmerican(origOdds)
    if (a != null && b != null) {
      const driftPp = +((Math.abs(a - b)) * 100).toFixed(2)
      if (driftPp >= PRICE_DRIFT_PP) {
        return { status: "price_drift", current: { line: original.line, odds: curOdds }, original, driftPp, ...stamp }
      }
    }
    return { status: "fresh", ...stamp }
  }

  const moved = pickNearestMovedLine(ctx.looseIx.get(looseKeyForBet(pick)), pick.line)
  if (moved) {
    const curOdds = Number(moved.odds ?? moved.oddsAmerican)
    return { status: "line_moved", current: { line: moved.line, odds: Number.isFinite(curOdds) ? curOdds : null }, original, ...stamp }
  }

  // Tuple vanished. Only a FRESH snapshot may testify "pulled" — a stale one
  // downgrades to an honest can't-confirm (never a false deathbed).
  if (meta.ageMinutes != null && meta.ageMinutes <= SUSPENDED_MAX_AGE_MIN) {
    return { status: "suspended", original, warning: "market may be pulled — verify in app before betting", ...stamp }
  }
  return { status: "unknown_stale", original, warning: `not in the last snapshot (${meta.ageMinutes != null ? meta.ageMinutes + "m old" : "age unknown"}) — can't confirm it still sells; verify in app`, ...stamp }
}

// ── event log (critic + weekly surface audit re-measure this) ────────────────
/**
 * Append one revalidation event as a jsonl line. Never throws (an event-log
 * failure must never block a serve). Only call for the NOTEWORTHY statuses
 * (line_moved / price_drift / suspended / error) — fresh cards are not events.
 */
function logFreshnessEvent(evt, { file } = {}) {
  try {
    const fp = file || DEFAULT_EVENTS_FILE
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.appendFileSync(fp, JSON.stringify({ ts: new Date().toISOString(), ...evt }) + "\n")
    return true
  } catch (_) { return false }
}

/** Read events (optionally filtered by slate). Garbled lines are skipped. */
function readFreshnessEvents({ file, slate } = {}) {
  try {
    const fp = file || DEFAULT_EVENTS_FILE
    const out = []
    for (const line of fs.readFileSync(fp, "utf8").split("\n")) {
      if (!line.trim()) continue
      try { const e = JSON.parse(line); if (!slate || e.slate === slate) out.push(e) } catch (_) {}
    }
    return out
  } catch (_) { return [] }
}

module.exports = {
  PRICE_DRIFT_PP,
  SUSPENDED_MAX_AGE_MIN,
  BAILOUT_MS,
  impliedFromAmerican,
  buildRevalidationContext,
  revalidatePick,
  logFreshnessEvent,
  readFreshnessEvents,
  DEFAULT_EVENTS_FILE,
  _resetContextCache,
}
