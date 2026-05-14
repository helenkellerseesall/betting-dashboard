#!/usr/bin/env node
"use strict"

/**
 * persistenceStatus.js — Phase Persistence-1B (2026-05-14)
 *
 *   Usage:
 *     node backend/scripts/persistenceStatus.js
 *     npm run persistence:status
 *
 * Canonical read-only inspector for the persistence layer. Replaces
 * ad-hoc `node -e "...DatabaseSync..."` shell snippets with one
 * structured, reproducible view.
 *
 * What it shows:
 *   - SQLite row counts for every table in betting.db
 *   - JSON file inventory in runtime/tracking/ with byte sizes
 *   - personal_ledger.json bet-count vs SQLite personal_ledger COUNT(*)
 *   - Ledger divergence log: most recent entries (if any)
 *   - prediction_id_aliases summary (count, by diff type)
 *
 * Pure observability. Read-only. Never mutates anything.
 */

const fs   = require("fs")
const path = require("path")

function main() {
  const t0 = Date.now()
  console.log("=== persistenceStatus — Phase Persistence-1B ===")

  const { tryGetDb, dbPath } = require("../storage/db")

  const db = tryGetDb()
  if (!db) {
    console.error("FATAL: SQLite unavailable.")
    process.exit(1)
  }

  console.log(`DB: ${dbPath()}`)
  console.log("")

  // ── SQLite row counts (sorted: active first, then dormant) ───────────────
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name)
    .filter((n) => !n.startsWith("sqlite_"))

  const counts = []
  for (const t of tables) {
    try {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
      counts.push({ table: t, count: n })
    } catch (e) {
      counts.push({ table: t, count: null, error: e.message })
    }
  }

  // Sort: active (count > 0) descending, then dormant (count == 0) alphabetical
  const active = counts.filter((c) => (c.count ?? 0) > 0).sort((a, b) => b.count - a.count)
  const dormant = counts.filter((c) => (c.count ?? 0) === 0).sort((a, b) => a.table.localeCompare(b.table))
  const errored = counts.filter((c) => c.error)

  console.log(`── SQLite tables (${tables.length} total) ──`)
  if (active.length > 0) {
    console.log("  ACTIVE:")
    for (const c of active) {
      console.log(`    ${c.table.padEnd(36)} ${String(c.count).padStart(8)}`)
    }
  }
  if (dormant.length > 0) {
    console.log("  DORMANT (0 rows):")
    for (const c of dormant) {
      console.log(`    ${c.table.padEnd(36)} ${String(c.count).padStart(8)}`)
    }
  }
  if (errored.length > 0) {
    console.log("  ERROR:")
    for (const c of errored) {
      console.log(`    ${c.table.padEnd(36)} ${c.error}`)
    }
  }
  console.log("")

  // ── JSON runtime/tracking inventory ──────────────────────────────────────
  const trackingDir = path.join(__dirname, "..", "runtime", "tracking")
  let trackingFiles = []
  try {
    trackingFiles = fs.readdirSync(trackingDir).map((name) => {
      const p = path.join(trackingDir, name)
      const st = fs.statSync(p)
      return { name, bytes: st.size, mtime: st.mtime }
    })
  } catch (_) {
    /* dir missing — fresh repo */
  }

  console.log(`── JSON runtime/tracking inventory (${trackingFiles.length} files) ──`)

  // Group by prefix (e.g. "mlb_tracked_bets_2026-05-09.json" → "mlb_tracked_bets")
  const groups = new Map()
  for (const f of trackingFiles) {
    let key = f.name
      .replace(/_\d{4}-\d{2}-\d{2}\.json$/i, "")
      .replace(/\.\d+$/, "")
      .replace(/\d+/g, "N")
    if (!groups.has(key)) groups.set(key, { count: 0, totalBytes: 0, sample: null })
    const g = groups.get(key)
    g.count += 1
    g.totalBytes += f.bytes
    if (!g.sample || f.mtime > g.sample.mtime) g.sample = f
  }

  // Sort groups by total bytes descending.
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].totalBytes - a[1].totalBytes)

  for (const [key, g] of sortedGroups) {
    const totalKb = (g.totalBytes / 1024).toFixed(1)
    console.log(
      `    ${key.padEnd(36)} ${String(g.count).padStart(4)} files   ${totalKb.padStart(10)} KB`
    )
  }
  console.log("")

  // ── Personal ledger parity ───────────────────────────────────────────────
  const ledgerPath = path.join(trackingDir, "personal_ledger.json")
  let ledgerJsonCount = null
  if (fs.existsSync(ledgerPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
      ledgerJsonCount = Array.isArray(data?.bets) ? data.bets.length : 0
    } catch (e) {
      ledgerJsonCount = `(parse error: ${e.message})`
    }
  }
  let ledgerSqliteCount = null
  try {
    ledgerSqliteCount = db.prepare("SELECT COUNT(*) AS n FROM personal_ledger").get().n
  } catch (_) {
    ledgerSqliteCount = "(table missing)"
  }
  console.log("── personal_ledger parity ──")
  console.log(`    JSON   bets[].length    : ${ledgerJsonCount}`)
  console.log(`    SQLite COUNT(*)         : ${ledgerSqliteCount}`)
  const delta = (typeof ledgerJsonCount === "number" && typeof ledgerSqliteCount === "number")
    ? (ledgerJsonCount - ledgerSqliteCount)
    : null
  if (delta != null) {
    if (delta > 0) {
      console.log(`    DIVERGENCE              : SQLite missing ${delta} bets  (run \`npm run persistence:import\`)`)
    } else if (delta < 0) {
      console.log(`    STEADY-STATE            : SQLite has ${-delta} more rows than JSON ring-buffer (expected after ring cycles past MAX_BETS=2000)`)
    } else {
      console.log(`    PARITY                  : ✓`)
    }
  }
  console.log("")

  // ── Recent divergence log entries ────────────────────────────────────────
  let divRows = []
  try {
    divRows = db
      .prepare("SELECT observed_at, json_bet_count, sqlite_bet_count, divergence, source, notes FROM ledger_divergence_log ORDER BY observed_at DESC LIMIT 5")
      .all()
  } catch (_) {
    /* table missing — fresh schema */
  }
  console.log(`── ledger_divergence_log (most recent 5) ──`)
  if (divRows.length === 0) {
    console.log("    (no divergence events recorded — either parity is intact, or boot integrity check hasn't run yet)")
  } else {
    for (const r of divRows) {
      console.log(`    ${r.observed_at}  json=${r.json_bet_count}  sqlite=${r.sqlite_bet_count}  delta=${r.divergence}  source=${r.source}  ${r.notes || ""}`)
    }
  }
  console.log("")

  // ── prediction_id_aliases summary ────────────────────────────────────────
  let aliasCount = 0
  let aliasByType = []
  try {
    aliasCount = db.prepare("SELECT COUNT(*) AS n FROM prediction_id_aliases").get().n
    aliasByType = db
      .prepare("SELECT norm_diff_type, COUNT(*) AS n FROM prediction_id_aliases GROUP BY norm_diff_type ORDER BY n DESC")
      .all()
  } catch (_) {
    /* table missing */
  }
  console.log(`── prediction_id_aliases summary ──`)
  console.log(`    total alias rows: ${aliasCount}`)
  if (aliasByType.length > 0) {
    console.log(`    by norm_diff_type:`)
    for (const r of aliasByType) {
      console.log(`      ${(r.norm_diff_type || "null").padEnd(12)}: ${r.n}`)
    }
  } else if (aliasCount === 0) {
    console.log(`    (no aliases recorded — either all IDs are already canonical,`)
    console.log(`     or the backfill hasn't run yet — \`npm run persistence:backfill-aliases\`)`)
  }
  console.log("")

  // ── Summary ──────────────────────────────────────────────────────────────
  const elapsedMs = Date.now() - t0
  const activeTables = active.length
  const dormantTables = dormant.length
  console.log("── SUMMARY ──")
  console.log(`  SQLite: ${tables.length} tables (${activeTables} active, ${dormantTables} dormant)`)
  console.log(`  JSON  : ${trackingFiles.length} files in runtime/tracking/`)
  console.log(`  Personal-ledger parity: ${delta == null ? "(unknown)" : delta > 0 ? "DIVERGENT (-" + delta + ")" : delta < 0 ? "steady-state cycled" : "intact"}`)
  console.log(`  Inspection completed in ${elapsedMs}ms`)
}

main()
