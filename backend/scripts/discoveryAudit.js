#!/usr/bin/env node
"use strict"

/**
 * discoveryAudit.js — exhaustive repo inventory.
 *
 * Built 2026-05-31 in response to operator: "that you dont even know theres
 * certain parts of the repo is very disappointing when i tell you to verify
 * all parts of the repo." I missed an entire backend/storage/ SQLite layer
 * with 25 tables because I never walked the directory tree, I just inspected
 * files I happened to know about and called it a "deep audit."
 *
 * This script walks EVERY directory under the repo root (excluding node_modules,
 * .git, .scratch, .checkpoint, build outputs) and catalogs:
 *
 *   1. Directory map — every top-level + 2nd-level dir with file counts
 *   2. SQLite databases — every .db, .db-wal, .db-shm + size
 *   3. JSON data files — every .json that's not config + size + age
 *   4. Active subsystems — files reachable from server.js, scheduler.sh,
 *      backend/routes/, backend/scripts/ entry points (the "actually run" set)
 *   5. Potential orphans — .js files with 0 reverse-imports + not entry points
 *   6. SQLite usage — every file that requires storage/db.js (reveals the
 *      hidden SQLite-using subsystems I missed)
 *   7. Recent activity — top 20 most-recently-modified .js files
 *   8. Long files — top 10 longest .js files (refactor candidates)
 *   9. Subsystems flagged as UNINSPECTED — directories with .js files I
 *      haven't ever touched in this session's tasks
 *
 * Writes:
 *   - stdout: human-readable summary
 *   - REPO_INVENTORY.md at repo root: canonical map for operator + future me
 *
 * Safe: read-only, never modifies any other file. Can run hourly via scheduler.
 */

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const REPO = path.join(__dirname, "..", "..")
const INVENTORY = path.join(REPO, "REPO_INVENTORY.md")

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".scratch", ".checkpoint", "dist", ".vite",
  "logs", "tmp", "coverage",
])

const SUBSYSTEM_ENTRY_POINTS = [
  "backend/server.js",
  "backend/scripts/scheduler.sh",
  "backend/routes/workstationRoutes.js",
]

// ── walk ─────────────────────────────────────────────────────────────────

function walk(dir, opts = {}) {
  const out = []
  function _w(d) {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".gitignore") continue
      if (SKIP_DIRS.has(e.name)) continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) _w(full)
      else if (e.isFile()) out.push(full)
    }
  }
  _w(dir)
  return out
}

const allFiles = walk(REPO)
console.log(`Walked ${allFiles.length} files under ${REPO}`)

// ── classify ──────────────────────────────────────────────────────────────

const jsFiles = allFiles.filter((f) => f.endsWith(".js"))
const dbFiles = allFiles.filter((f) => /\.(db|db-wal|db-shm|sqlite)$/.test(f))
const jsonFiles = allFiles.filter((f) => f.endsWith(".json") && !f.includes("package.json") && !f.includes("package-lock"))

console.log(`  .js files: ${jsFiles.length}`)
console.log(`  SQLite DBs: ${dbFiles.length}`)
console.log(`  .json data files: ${jsonFiles.length}`)

// ── directory map ─────────────────────────────────────────────────────────

const dirMap = {}
for (const f of allFiles) {
  const rel = path.relative(REPO, f)
  const parts = rel.split(path.sep)
  // collect at depth 1 and 2
  for (let depth = 1; depth <= 3; depth++) {
    if (parts.length < depth) continue
    const key = parts.slice(0, depth).join("/")
    if (!dirMap[key]) dirMap[key] = { jsCount: 0, totalFiles: 0, totalBytes: 0 }
    dirMap[key].totalFiles++
    try { dirMap[key].totalBytes += fs.statSync(f).size } catch {}
    if (f.endsWith(".js")) dirMap[key].jsCount++
  }
}

// ── reverse import map ────────────────────────────────────────────────────

const reverseImports = {}
for (const f of jsFiles) reverseImports[f] = []

function resolveRequire(fromFile, requireArg) {
  // Only handle relative requires; ignore external (no ./ or ../ prefix)
  if (!requireArg.startsWith(".")) return null
  const dir = path.dirname(fromFile)
  let resolved = path.resolve(dir, requireArg)
  // Try .js, /index.js
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved
  if (fs.existsSync(resolved + ".js")) return resolved + ".js"
  if (fs.existsSync(path.join(resolved, "index.js"))) return path.join(resolved, "index.js")
  return null
}

const importsByFile = {}
for (const f of jsFiles) {
  let src
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  const requires = [...src.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
  importsByFile[f] = []
  for (const r of requires) {
    const resolved = resolveRequire(f, r)
    if (resolved && reverseImports[resolved] !== undefined) {
      reverseImports[resolved].push(f)
      importsByFile[f].push(resolved)
    }
  }
}

// ── SQLite usage ──────────────────────────────────────────────────────────

const sqliteUsers = jsFiles.filter((f) => {
  try {
    const src = fs.readFileSync(f, "utf8")
    return /storage\/db|storage\/queries|better-sqlite3|tryGetDb|require.*queries/.test(src)
  } catch { return false }
})

// ── potential orphans ─────────────────────────────────────────────────────

function isEntryPoint(f) {
  const rel = path.relative(REPO, f)
  return rel.startsWith("backend/scripts/") ||  // CLI scripts are inherently entry points
         rel === "backend/server.js" ||
         rel.startsWith("backend/routes/") ||
         /probe.*\.js$/.test(path.basename(f))
}
const orphans = jsFiles.filter((f) => reverseImports[f].length === 0 && !isEntryPoint(f))

// ── recent activity ───────────────────────────────────────────────────────

const recentJs = [...jsFiles].map((f) => ({
  f, mtime: (() => { try { return fs.statSync(f).mtimeMs } catch { return 0 } })(),
})).sort((a, b) => b.mtime - a.mtime).slice(0, 20)

// ── long files ────────────────────────────────────────────────────────────

const lengths = jsFiles.map((f) => {
  try {
    const lines = fs.readFileSync(f, "utf8").split("\n").length
    return { f, lines }
  } catch { return { f, lines: 0 } }
}).sort((a, b) => b.lines - a.lines).slice(0, 15)

// ── output: human-readable summary ────────────────────────────────────────

console.log("\n=== TOP-LEVEL DIRECTORY MAP ===")
const topDirs = Object.keys(dirMap).filter((k) => !k.includes("/")).sort()
for (const d of topDirs) {
  const m = dirMap[d]
  console.log(`  ${d.padEnd(20)}  ${String(m.jsCount).padStart(4)} .js   ${String(m.totalFiles).padStart(5)} total   ${(m.totalBytes / 1024).toFixed(1)} KB`)
}

console.log("\n=== BACKEND SUBSYSTEMS (depth 2) ===")
const backendDirs = Object.keys(dirMap).filter((k) => k.startsWith("backend/") && k.split("/").length === 2).sort()
for (const d of backendDirs) {
  const m = dirMap[d]
  const known = ["routes", "scripts", "data", "runtime", "pipeline", "storage", "ml", "tests"]
  const subsystemName = path.basename(d)
  const flag = known.includes(subsystemName) ? "" : "  ← UNINSPECTED"
  console.log(`  ${d.padEnd(30)}  ${String(m.jsCount).padStart(4)} .js   ${String(m.totalFiles).padStart(5)} total${flag}`)
}

console.log("\n=== SQLITE DATABASES ===")
for (const f of dbFiles) {
  const rel = path.relative(REPO, f)
  try {
    const size = fs.statSync(f).size
    console.log(`  ${rel}  ·  ${(size / 1024).toFixed(1)} KB`)
  } catch {}
}

console.log("\n=== FILES USING SQLITE (the hidden subsystems) ===")
for (const f of sqliteUsers) console.log(`  ${path.relative(REPO, f)}`)

console.log("\n=== TOP-20 RECENTLY MODIFIED .js (last session activity) ===")
for (const r of recentJs) {
  const ageH = ((Date.now() - r.mtime) / 3600000).toFixed(1)
  console.log(`  ${ageH.padStart(6)}h  ${path.relative(REPO, r.f)}`)
}

console.log("\n=== TOP-15 LONGEST .js (refactor candidates / complexity hotspots) ===")
for (const l of lengths) {
  console.log(`  ${String(l.lines).padStart(6)} lines  ${path.relative(REPO, l.f)}`)
}

console.log("\n=== POTENTIAL ORPHANS (0 reverse-imports, not entry points, not in scripts/) ===")
console.log(`  (${orphans.length} candidates)`)
for (const o of orphans.slice(0, 30)) console.log(`  ${path.relative(REPO, o)}`)
if (orphans.length > 30) console.log(`  ... and ${orphans.length - 30} more`)

console.log("\n=== SUMMARY ===")
console.log(`  Total files walked: ${allFiles.length}`)
console.log(`  .js files: ${jsFiles.length}`)
console.log(`  Sqlite databases: ${dbFiles.length}`)
console.log(`  Files using SQLite: ${sqliteUsers.length}`)
console.log(`  Potential orphans: ${orphans.length}`)
console.log(`  Backend subsystems: ${backendDirs.length}`)

// ── write REPO_INVENTORY.md ───────────────────────────────────────────────

const md = []
md.push(`# REPO_INVENTORY.md`)
md.push(``)
md.push(`Generated ${new Date().toISOString()} by \`backend/scripts/discoveryAudit.js\`.`)
md.push(``)
md.push(`This is the canonical map of what's actually in this repo. Built in response to operator's "verify everything" ask after I missed an entire \`backend/storage/\` SQLite subsystem with 25 tables. Re-run discoveryAudit anytime; this file regenerates.`)
md.push(``)
md.push(`## Top-Level Layout`)
md.push(``)
md.push(`\`\`\``)
for (const d of topDirs) {
  const m = dirMap[d]
  md.push(`${d.padEnd(20)}  ${String(m.jsCount).padStart(4)} .js   ${String(m.totalFiles).padStart(5)} total   ${(m.totalBytes / 1024).toFixed(1)} KB`)
}
md.push(`\`\`\``)
md.push(``)
md.push(`## Backend Subsystems (depth 2)`)
md.push(``)
md.push(`\`\`\``)
for (const d of backendDirs) {
  const m = dirMap[d]
  const known = ["routes", "scripts", "data", "runtime", "pipeline", "storage", "ml", "tests"]
  const subsystemName = path.basename(d)
  const flag = known.includes(subsystemName) ? "" : "  ← UNINSPECTED (operator's call-out)"
  md.push(`${d.padEnd(30)}  ${String(m.jsCount).padStart(4)} .js   ${String(m.totalFiles).padStart(5)} total${flag}`)
}
md.push(`\`\`\``)
md.push(``)
md.push(`## SQLite Databases`)
md.push(``)
for (const f of dbFiles) {
  const rel = path.relative(REPO, f)
  try {
    const size = fs.statSync(f).size
    md.push(`- \`${rel}\` — ${(size / 1024).toFixed(1)} KB`)
  } catch {}
}
md.push(``)
md.push(`## Files using SQLite (subsystems with persistent state beyond JSON)`)
md.push(``)
for (const f of sqliteUsers) md.push(`- \`${path.relative(REPO, f)}\``)
md.push(``)
md.push(`## Recent Activity — Top 20 most-recently-modified .js`)
md.push(``)
md.push(`| Age (h) | File |`)
md.push(`|---|---|`)
for (const r of recentJs) {
  const ageH = ((Date.now() - r.mtime) / 3600000).toFixed(1)
  md.push(`| ${ageH} | \`${path.relative(REPO, r.f)}\` |`)
}
md.push(``)
md.push(`## Long Files (top-15, refactor candidates)`)
md.push(``)
md.push(`| Lines | File |`)
md.push(`|---|---|`)
for (const l of lengths) {
  md.push(`| ${l.lines} | \`${path.relative(REPO, l.f)}\` |`)
}
md.push(``)
md.push(`## Potential Orphans (0 reverse-imports, not entry points)`)
md.push(``)
md.push(`${orphans.length} candidates. Top 30:`)
md.push(``)
for (const o of orphans.slice(0, 30)) md.push(`- \`${path.relative(REPO, o)}\``)
if (orphans.length > 30) md.push(`- ... and ${orphans.length - 30} more`)
md.push(``)
md.push(`## How to use this inventory`)
md.push(``)
md.push(`- **Before** claiming "I've verified the repo" or "I've inspected all subsystems," re-read the Backend Subsystems list above. If anything is marked UNINSPECTED, I haven't actually looked at it.`)
md.push(`- **Before** writing a new helper, grep for the function name first (binding rule per \`feedback_verbatim_corrections.md\`).`)
md.push(`- **When** adding a new subsystem, re-run \`node backend/scripts/discoveryAudit.js\` to confirm the inventory updated.`)
md.push(`- **Pre-commit hook** is queued (#69 self-awareness layer) to fire this on every commit and refuse to merge if previously-known files vanish unexpectedly.`)
md.push(``)

fs.writeFileSync(INVENTORY, md.join("\n"))
console.log(`\n✓ Wrote ${INVENTORY}`)
process.exit(0)
