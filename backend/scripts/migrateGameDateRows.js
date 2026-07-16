#!/usr/bin/env node
"use strict"

/**
 * migrateGameDateRows.js — NIGHT-OWL-1 one-time placement correction (2026-07-15).
 *
 * Moves MLB tracked rows whose GAME's slate date ≠ the file they live in, into
 * their game-date file (the slate-vs-game-date offset: evening forward-rolled
 * refreshes scored NEXT-DAY games into the generation-date file — measured
 * live 2026-07-15: 262 rows for 07-16 games sitting in the 07-15 file).
 *
 * Discipline (per the 07-11 backfill lesson):
 *   - DRY by default; --write required to touch anything.
 *   - Every write produces a from→to DELTA MANIFEST
 *     (runtime/tracking/night_owl_migration_<ts>.json) so the correction can
 *     be replayed/audited even if terminal history is lost.
 *   - Rows move AS-IS — ids and `date` fields keep their original
 *     generation-date values (identity preserved: the personal ledger mirrors
 *     these ids; grading + Daily-3 + CLV all join on tuple/gameTime, not id).
 *     Placement is corrected; history is not rewritten.
 *   - Settled rows (result !== "pending") move with results intact; nothing is
 *     regraded or dropped. Merge into the target keeps EXISTING target rows on
 *     id collision (sticky-open doctrine: only open* fields backfill if the
 *     source observation is EARLIER).
 *
 * Usage:
 *   node backend/scripts/migrateGameDateRows.js            (dry)
 *   node backend/scripts/migrateGameDateRows.js --write
 *   node backend/scripts/migrateGameDateRows.js --days=5   (lookback, default 3)
 */

const fs = require("fs")
const path = require("path")
const { slateDateForTimestamp } = require("../pipeline/shared/slateDate")
const { gameSlateDateFor } = require("../pipeline/mlb/phase4Tracking")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const WRITE = process.argv.includes("--write")
const DAYS = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 3

const readJson = (fp) => { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return null } }
const dateKeys = []
for (let i = 0; i < DAYS; i++) dateKeys.push(slateDateForTimestamp(Date.now() - i * 24 * 3600 * 1000))

// ── INTEGRITY ASSERTION (operator-required, 2026-07-15) ─────────────────────
// The migration MOVES rows between date-keyed files but NEVER alters
// results/stamps. Proof, not claim:
//   - Every moved row gets a signature over its integrity tuple
//     (identity | result | settledAt | openOdds | openObservedAt |
//      openImpliedProb | closeOdds | clv). DRY prints the planned checksum.
//   - --write re-reads every target file afterward, recomputes the same
//     signatures on the landed rows, and prints MATCH / MISMATCH
//     (mismatch ⇒ exit 1, loud). Both checksums go in the manifest.
//   - id collisions are structurally impossible cross-date (bet ids embed the
//     generation date, which differs by construction); the guard remains, and
//     if it ever fires the sticky-open backfill applies to PENDING target rows
//     ONLY — settled rows are never touched, not even their open stamps.
function fnv32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0 }
  return ("0000000" + h.toString(16)).slice(-8)
}
const keyOf = (r) => r.id || `${(r.player || "").toLowerCase()}|${r.propType || r.statFamily || ""}|${r.side || ""}|${r.line}|${(r.book || r.sportsbook || "").toLowerCase()}`
const sigOf = (r) => `${keyOf(r)}|${r.result ?? ""}|${r.settledAt ?? ""}|${r.openOdds ?? ""}|${r.openObservedAt ?? ""}|${r.openImpliedProb ?? ""}|${r.closeOdds ?? ""}|${r.clv ?? ""}`
const checksumOf = (sigs) => fnv32([...sigs].sort().join("\n"))
const isSettled = (r) => r.result && r.result !== "pending"

const manifest = { ranAt: new Date().toISOString(), mode: WRITE ? "write" : "dry", lookbackDays: DAYS, moves: [] }
let totalMoved = 0
let totalSettledMoved = 0
const plannedSigs = []
const verifyPlan = [] // { path, prefix, keys: Set, sigsByKey: Map } per target — re-read proof after write

function migrateArrayFile(prefix, fileDate, getRows, setRows) {
  const srcPath = path.join(TRACKING, `${prefix}${fileDate}.json`)
  const srcRaw = readJson(srcPath)
  if (!srcRaw) return
  const rows = getRows(srcRaw)
  if (!Array.isArray(rows) || !rows.length) return

  const stay = []
  const moveByDate = new Map()
  for (const r of rows) {
    const target = gameSlateDateFor(r, fileDate)
    if (target === fileDate) { stay.push(r) } else {
      if (!moveByDate.has(target)) moveByDate.set(target, [])
      moveByDate.get(target).push(r)
    }
  }
  if (!moveByDate.size) return

  for (const [target, moved] of moveByDate) {
    const tgtPath = path.join(TRACKING, `${prefix}${target}.json`)
    const moveSigs = moved.map(sigOf)
    const settledCount = moved.filter(isSettled).length
    const entry = {
      file: path.basename(srcPath), to: path.basename(tgtPath),
      rows: moved.length, settled: settledCount, integrityChecksum: checksumOf(moveSigs),
      sampleIds: moved.slice(0, 3).map((r) => r.id || `${r.player}|${r.propType || r.statFamily}|${r.side}|${r.line}`),
      results: moved.reduce((a, r) => { const k = r.result || "no-result-field"; a[k] = (a[k] || 0) + 1; return a }, {}),
    }
    manifest.moves.push(entry)
    totalMoved += moved.length
    totalSettledMoved += settledCount
    plannedSigs.push(...moveSigs)
    const vp = { path: tgtPath, prefix, sigsByKey: new Map(moved.map((r) => [keyOf(r), sigOf(r)])) }
    verifyPlan.push(vp)
    console.log(`${WRITE ? "MOVE" : "DRY "} ${entry.file} → ${entry.to}: ${entry.rows} rows ${JSON.stringify(entry.results)} · settled ${settledCount} · checksum ${entry.integrityChecksum}`)

    if (WRITE) {
      const tgtRaw = readJson(tgtPath)
      if (prefix === "mlb_tracked_bets_") {
        const tgt = Array.isArray(tgtRaw) ? tgtRaw : []
        const byId = new Map(tgt.map((b) => [b.id, b]))
        for (const m of moved) {
          const prev = byId.get(m.id)
          if (!prev) { byId.set(m.id, m); continue }
          // id collision (structurally impossible cross-date — ids embed the
          // generation date — but guarded): keep the target row. Sticky-open
          // backfill on PENDING rows only; SETTLED rows are never touched,
          // not even their open stamps (integrity assertion).
          if (isSettled(prev)) continue
          if (m.openObservedAt && (!prev.openObservedAt || m.openObservedAt < prev.openObservedAt)) {
            prev.openOdds = m.openOdds ?? prev.openOdds
            prev.openObservedAt = m.openObservedAt
            prev.openImpliedProb = m.openImpliedProb ?? prev.openImpliedProb
          }
        }
        fs.writeFileSync(tgtPath, JSON.stringify([...byId.values()], null, 2))
      } else {
        // payload files: {metadata, entries|picks}
        const listKey = prefix === "mlb_tracked_best_" ? "entries" : "picks"
        const tgt = tgtRaw && typeof tgtRaw === "object" ? tgtRaw : { metadata: { sport: "mlb", slateDate: target, migratedSeed: true }, [listKey]: [] }
        if (!Array.isArray(tgt[listKey])) tgt[listKey] = []
        const seen = new Set(tgt[listKey].map((e) => `${(e.player || "").toLowerCase()}|${e.propType || ""}|${e.side || ""}|${e.line}|${(e.book || e.sportsbook || "").toLowerCase()}`))
        for (const m of moved) {
          const k = `${(m.player || "").toLowerCase()}|${m.propType || ""}|${m.side || ""}|${m.line}|${(m.book || m.sportsbook || "").toLowerCase()}`
          if (!seen.has(k)) { seen.add(k); tgt[listKey].push(m) }
        }
        fs.writeFileSync(tgtPath, JSON.stringify(tgt, null, 2))
      }
    }
  }
  if (WRITE) setRows(srcRaw, stay, srcPath)
}

for (const fileDate of dateKeys) {
  migrateArrayFile("mlb_tracked_bets_", fileDate,
    (raw) => raw,
    (raw, stay, fp) => fs.writeFileSync(fp, JSON.stringify(stay, null, 2)))
  migrateArrayFile("mlb_tracked_best_", fileDate,
    (raw) => (raw && Array.isArray(raw.entries) ? raw.entries : []),
    (raw, stay, fp) => { raw.entries = stay; fs.writeFileSync(fp, JSON.stringify(raw, null, 2)) })
  migrateArrayFile("mlb_picks_", fileDate,
    (raw) => (raw && Array.isArray(raw.picks) ? raw.picks : []),
    (raw, stay, fp) => { raw.picks = stay; fs.writeFileSync(fp, JSON.stringify(raw, null, 2)) })
}

if (!manifest.moves.length) {
  console.log(`migrateGameDateRows: nothing misplaced in the last ${DAYS} slate files — clean.`)
} else if (WRITE) {
  // ── INTEGRITY PROOF: re-read every target, recompute signatures on the
  // landed rows, compare to the plan. MISMATCH ⇒ exit 1, loud.
  manifest.plannedChecksum = checksumOf(plannedSigs)
  manifest.settledMoved = totalSettledMoved
  const landedSigs = []
  let missing = 0
  for (const vp of verifyPlan) {
    const raw = readJson(vp.path)
    const list = vp.prefix === "mlb_tracked_bets_" ? (Array.isArray(raw) ? raw : [])
      : vp.prefix === "mlb_tracked_best_" ? (raw?.entries || []) : (raw?.picks || [])
    const byKey = new Map(list.map((r) => [keyOf(r), r]))
    for (const [k] of vp.sigsByKey) {
      const landed = byKey.get(k)
      if (!landed) { missing++; continue }
      landedSigs.push(sigOf(landed))
    }
  }
  manifest.verifiedChecksum = checksumOf(landedSigs)
  manifest.verifiedRows = landedSigs.length
  manifest.missingAfterWrite = missing
  const match = manifest.verifiedChecksum === manifest.plannedChecksum && missing === 0
  const mf = path.join(TRACKING, `night_owl_migration_${Date.now()}.json`)
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 2))
  console.log(`migrateGameDateRows: MOVED ${totalMoved} rows (${totalSettledMoved} settled) · delta manifest → ${path.basename(mf)}`)
  console.log(`INTEGRITY PROOF: planned ${manifest.plannedChecksum} vs landed ${manifest.verifiedChecksum} over ${landedSigs.length}/${totalMoved} rows${missing ? ` · ${missing} MISSING` : ""} — ${match ? "MATCH (results/stamps byte-identical)" : "MISMATCH — INVESTIGATE, do not trust this write"}`)
  if (!match) process.exit(1)
} else {
  console.log(`INTEGRITY (planned): ${totalMoved} rows · ${totalSettledMoved} settled · checksum ${checksumOf(plannedSigs)} — the write must land these byte-identical on result/settledAt/opens/closes/clv (proof re-read prints on --write).`)
  console.log(`migrateGameDateRows: DRY — ${totalMoved} rows would move. Re-run with --write after eyeballing.`)
}
