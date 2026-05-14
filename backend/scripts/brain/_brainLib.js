"use strict"

/**
 * Shared helpers for brain enforcement scripts. Pure parsing / fs / no
 * external deps. Truthful diagnostics — no synthetic synchronization state.
 *
 * Used by:
 *   - loadBrainContext.js   (npm run brain:bootstrap)
 *   - brainSyncSummary.js   (npm run brain:status)
 *   - verifyBrainFreshness.js (npm run brain:verify)
 *   - enforceBrainCheckpoint.js (npm run brain:checkpoint)
 */

const fs     = require("fs")
const path   = require("path")
const crypto = require("crypto")

const BRAIN_DIR = path.join(__dirname, "..", "..", "runtime", "brain")
const BACKEND_ROOT = path.join(__dirname, "..", "..")
const REPO_ROOT = path.join(BACKEND_ROOT, "..")

// Phase: autonomous continuity enforcement
// Bootstrap receipt: persisted state that proves the brain ceremony was
// recently performed AND captures the state hashes at that moment. Used to
// detect drift between sessions and to hard-fail checkpoint when runtime code
// has mutated without a corresponding brain bootstrap/reconciliation.
const BOOTSTRAP_RECEIPT_PATH = path.join(BRAIN_DIR, ".brain_bootstrap_state.json")

// Hard staleness thresholds (operator-tunable via env if needed).
const CONTINUITY_BOOTSTRAP_WARN_MINUTES =
  Number(process.env.BRAIN_BOOTSTRAP_WARN_MINUTES) || 8 * 60     // 8 hours
const CONTINUITY_BOOTSTRAP_FAIL_MINUTES =
  Number(process.env.BRAIN_BOOTSTRAP_FAIL_MINUTES) || 7 * 24 * 60 // 7 days
const CONTINUITY_RUNTIME_LAG_FAIL_MINUTES =
  Number(process.env.BRAIN_RUNTIME_LAG_FAIL_MINUTES) || 60        // 1 hour

const BRAIN_FILES = [
  "MASTER_BRAIN.md",
  "OPERATOR_PROTOCOL.md",
  "CURRENT_RUNTIME_STATE.md",
  "ARCHITECTURE_LAWS.md",
  "ACTIVE_INCIDENTS.md",
  "PIPELINE_AUTHORITY_MAP.md",
  "MODEL_EVOLUTION_LOG.md",
  "SPORTSBOOK_CONTRACTS.md",
  "README.md",
]

// Subset that MUST be updated after any meaningful code patch (per
// ARCHITECTURE_LAWS.md Law 12).
const BRAIN_REQUIRED_ON_PATCH = [
  "MASTER_BRAIN.md",
  "CURRENT_RUNTIME_STATE.md",
  "MODEL_EVOLUTION_LOG.md",
]

// Code-area directories that count as "meaningful runtime work" for the
// checkpoint enforcement check.
const RUNTIME_CODE_DIRS = [
  path.join(BACKEND_ROOT, "http"),
  path.join(BACKEND_ROOT, "pipeline"),
  path.join(BACKEND_ROOT, "routes"),
  path.join(BACKEND_ROOT, "storage"),
  path.join(BACKEND_ROOT, "server.js"),
]

function readBrainFile(name) {
  const p = path.join(BRAIN_DIR, name)
  if (!fs.existsSync(p)) return null
  return fs.readFileSync(p, "utf8")
}

function brainFileStats(name) {
  const p = path.join(BRAIN_DIR, name)
  if (!fs.existsSync(p)) return { name, exists: false }
  const st = fs.statSync(p)
  const content = fs.readFileSync(p, "utf8")
  return {
    name,
    path: p,
    exists: true,
    mtime: st.mtime,
    mtimeIso: st.mtime.toISOString(),
    lines: content.split("\n").length,
    bytes: st.size,
  }
}

// Pull the "Last updated: ..." line out of a brain doc header.
function extractLastUpdated(content) {
  if (!content) return null
  const m = content.match(/_Last updated:\s*([^_]+?)_/)
  return m ? m[1].trim() : null
}

// MASTER_BRAIN.md "CURRENT PROJECT PHASE" section text.
function extractCurrentProjectPhase(masterBrainContent) {
  if (!masterBrainContent) return null
  const re = /## CURRENT PROJECT PHASE\s*\n+([\s\S]*?)\n## /
  const m = masterBrainContent.match(re)
  return m ? m[1].trim() : null
}

// MASTER_BRAIN.md "CURRENT PRIORITIES" section as an array of one-line items.
function extractCurrentPriorities(masterBrainContent) {
  if (!masterBrainContent) return []
  const re = /## CURRENT PRIORITIES\s*\n+([\s\S]*?)\n## /
  const m = masterBrainContent.match(re)
  if (!m) return []
  // Capture numbered list items
  return m[1].split("\n")
    .map((s) => s.trim())
    .filter((s) => /^\d+\.\s/.test(s))
}

// Generic top-level-section extractor — pulls everything between
// `## <name>` and the next `## ` heading.
function extractSection(content, name) {
  if (!content) return null
  const re = new RegExp(
    "##\\s+" + name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "\\s*\\n+([\\s\\S]*?)\\n## ")
  const m = content.match(re)
  return m ? m[1].trim() : null
}

// MASTER_BRAIN.md "DO NOT REINTRODUCE" section as bullet list.
function extractDoNotReintroduce(masterBrainContent) {
  if (!masterBrainContent) return []
  const re = /## DO NOT REINTRODUCE\s*\n+([\s\S]*?)\n## /
  const m = masterBrainContent.match(re)
  if (!m) return []
  return m[1].split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("- "))
    .map((s) => s.replace(/^- /, ""))
}

// ARCHITECTURE_LAWS.md — extract the law headers ("## Law N — title").
function extractArchitectureLaws(lawsContent) {
  if (!lawsContent) return []
  const lines = lawsContent.split("\n")
  const laws = []
  for (const line of lines) {
    const m = line.match(/^## Law\s+(\d+)\s*[—-]\s*(.+)$/)
    if (m) laws.push({ n: Number(m[1]), title: m[2].trim() })
  }
  return laws
}

// ACTIVE_INCIDENTS.md — extract open and watch incidents (id + title + line).
function extractOpenIncidents(incidentsContent) {
  if (!incidentsContent) return []
  // We look for ### INC-NNN — Title lines inside the "OPEN" subsections,
  // stopping when we hit the "RESOLVED" section.
  const resolvedAt = incidentsContent.indexOf("## RESOLVED")
  const openOnly = resolvedAt >= 0 ? incidentsContent.slice(0, resolvedAt) : incidentsContent
  const lines = openOnly.split("\n")
  const incidents = []
  let pendingId = null
  let pendingTitle = null
  let pendingStatus = null
  for (const line of lines) {
    const idMatch = line.match(/^###\s+(INC-\d+)\s*[—-]\s*(.+)$/)
    if (idMatch) {
      if (pendingId) incidents.push({ id: pendingId, title: pendingTitle, status: pendingStatus })
      pendingId = idMatch[1]
      pendingTitle = idMatch[2].trim()
      pendingStatus = null
      continue
    }
    const statusMatch = line.match(/\*\*Status\*\*:\s*([^\n]+)/)
    if (statusMatch && pendingId) {
      pendingStatus = statusMatch[1].trim().split("—")[0].trim()
    }
  }
  if (pendingId) incidents.push({ id: pendingId, title: pendingTitle, status: pendingStatus })
  return incidents
}

// MODEL_EVOLUTION_LOG.md — extract the most recent N entries (## date — title).
function extractRecentEvolutionEntries(logContent, limit) {
  if (!logContent) return []
  const cap = Number.isFinite(limit) ? limit : 5
  const lines = logContent.split("\n")
  const entries = []
  for (const line of lines) {
    const m = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.+)$/)
    if (m) {
      entries.push({ date: m[1], title: m[2].trim() })
      if (entries.length >= cap) break
    }
  }
  return entries
}

// Find the most recent mtime among files in a directory tree (or a single file).
function mostRecentMtime(target) {
  if (!fs.existsSync(target)) return null
  const st = fs.statSync(target)
  if (st.isFile()) return st.mtime
  let max = st.mtime
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const p = path.join(d, entry.name)
      const s = fs.statSync(p)
      if (s.isDirectory()) walk(p)
      else if (s.mtime > max) max = s.mtime
    }
  }
  walk(target)
  return max
}

function brainDirMostRecentMtime() {
  let max = null
  for (const f of BRAIN_FILES) {
    const p = path.join(BRAIN_DIR, f)
    if (!fs.existsSync(p)) continue
    const m = fs.statSync(p).mtime
    if (!max || m > max) max = m
  }
  return max
}

function runtimeCodeMostRecentMtime() {
  let max = null
  for (const target of RUNTIME_CODE_DIRS) {
    const m = mostRecentMtime(target)
    if (m && (!max || m > max)) max = m
  }
  return max
}

// ─── Continuity state primitives ───────────────────────────────────────────

// Sort-then-concat-then-sha256 hash for an array of absolute file paths.
// Deterministic across runs and across operators — what changes is the bytes.
function hashFiles(paths) {
  const h = crypto.createHash("sha256")
  for (const p of paths.slice().sort()) {
    if (!fs.existsSync(p)) continue
    h.update(p + "\0")
    h.update(fs.readFileSync(p))
    h.update("\0")
  }
  return "sha256:" + h.digest("hex")
}

function listRuntimeCodeFiles() {
  const out = []
  function walk(d) {
    if (!fs.existsSync(d)) return
    const st = fs.statSync(d)
    if (st.isFile()) {
      // Underscore-prefixed `.js` files are local scratch / test artifacts and
      // are deliberately excluded so transient files don't churn the runtime
      // hash. Production files never use this prefix.
      const base = path.basename(d)
      if (/^_/.test(base)) return
      if (/\.js$/.test(d)) out.push(d)
      return
    }
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      if (entry.isFile() && /^_/.test(entry.name)) continue
      walk(path.join(d, entry.name))
    }
  }
  for (const target of RUNTIME_CODE_DIRS) walk(target)
  return out
}

function listBrainFilePaths() {
  return BRAIN_FILES.map((f) => path.join(BRAIN_DIR, f))
}

function hashBrainDocs() {
  return hashFiles(listBrainFilePaths())
}

function hashRuntimeCode() {
  return hashFiles(listRuntimeCodeFiles())
}

function readBootstrapReceipt() {
  if (!fs.existsSync(BOOTSTRAP_RECEIPT_PATH)) return null
  try {
    return JSON.parse(fs.readFileSync(BOOTSTRAP_RECEIPT_PATH, "utf8"))
  } catch {
    return null
  }
}

function writeBootstrapReceipt(updates) {
  const prev = readBootstrapReceipt() || {}
  const merged = { ...prev, ...(updates && typeof updates === "object" ? updates : {}) }
  merged.schemaVersion = 1
  fs.writeFileSync(BOOTSTRAP_RECEIPT_PATH, JSON.stringify(merged, null, 2) + "\n")
  return merged
}

// Returns a structured continuity assessment. Truthful — no synthetic state.
function assessContinuity() {
  const receipt = readBootstrapReceipt()
  const now = new Date()
  const out = {
    receiptPresent: !!receipt,
    receipt,
    issues: [],   // hard problems (treated as FAIL in checkpoint)
    warnings: [], // soft problems (advisory)
    currentBrainHash:   hashBrainDocs(),
    currentRuntimeHash: hashRuntimeCode(),
    runtimeCodeMostRecentMtime: runtimeCodeMostRecentMtime(),
    brainDirMostRecentMtime:    brainDirMostRecentMtime(),
    now,
  }

  if (!receipt) {
    out.issues.push({
      code: "NO_BOOTSTRAP_RECEIPT",
      message: "no .brain_bootstrap_state.json — run `npm run brain:bootstrap` to seed continuity tracking",
    })
    return out
  }

  // Stale bootstrap
  if (receipt.lastBootstrapAt) {
    const lastBoot = new Date(receipt.lastBootstrapAt)
    const ageMin = Math.round((now.getTime() - lastBoot.getTime()) / 60000)
    out.bootstrapAgeMinutes = ageMin
    if (ageMin >= CONTINUITY_BOOTSTRAP_FAIL_MINUTES) {
      out.issues.push({
        code: "BOOTSTRAP_TOO_OLD",
        message: `last bootstrap was ${ageMin} min ago (>= ${CONTINUITY_BOOTSTRAP_FAIL_MINUTES}) — run \`npm run brain:bootstrap\``,
      })
    } else if (ageMin >= CONTINUITY_BOOTSTRAP_WARN_MINUTES) {
      out.warnings.push({
        code: "BOOTSTRAP_AGING",
        message: `last bootstrap was ${ageMin} min ago (>= ${CONTINUITY_BOOTSTRAP_WARN_MINUTES} warn threshold)`,
      })
    }
  } else {
    out.issues.push({
      code: "NO_BOOTSTRAP_AT",
      message: "receipt lacks lastBootstrapAt — re-run `npm run brain:bootstrap`",
    })
  }

  // Runtime drift since last bootstrap
  if (receipt.runtimeCodeHashAtBootstrap) {
    if (receipt.runtimeCodeHashAtBootstrap !== out.currentRuntimeHash) {
      const lagMin = diffMinutes(out.runtimeCodeMostRecentMtime, new Date(receipt.lastBootstrapAt))
      out.runtimeChangedSinceBootstrap = true
      out.runtimeLagMinutes = lagMin
      // Hard issue only if the lag exceeds the runtime-lag threshold AND no
      // post-bootstrap reconciliation has occurred.
      const hasFreshReconcile = receipt.runtimeCodeHashAtCheckpoint === out.currentRuntimeHash
      if (!hasFreshReconcile) {
        if (Number.isFinite(lagMin) && lagMin >= CONTINUITY_RUNTIME_LAG_FAIL_MINUTES) {
          out.issues.push({
            code: "RUNTIME_CHANGED_NO_RECONCILE",
            message: `runtime code hash changed since last bootstrap (lag ~${lagMin} min) without subsequent reconciliation — re-run \`npm run brain:bootstrap\` and \`npm run brain:checkpoint\``,
          })
        } else {
          out.warnings.push({
            code: "RUNTIME_CHANGED_RECENT",
            message: `runtime code hash changed since last bootstrap (lag ~${lagMin || "?"} min) — reconciliation expected at end of session`,
          })
        }
      }
    }
  }

  // Brain drift since last bootstrap (rare — would mean external docs edit)
  if (receipt.brainDocHashAtBootstrap && receipt.brainDocHashAtBootstrap !== out.currentBrainHash) {
    out.brainChangedSinceBootstrap = true
    out.warnings.push({
      code: "BRAIN_CHANGED_SINCE_BOOTSTRAP",
      message: "brain docs have been modified since the last bootstrap — expected if you've been updating memory docs",
    })
  }

  // Checkpoint reconciliation freshness
  if (receipt.lastCheckpointAt) {
    const lastChk = new Date(receipt.lastCheckpointAt)
    const ageMin = Math.round((now.getTime() - lastChk.getTime()) / 60000)
    out.checkpointAgeMinutes = ageMin
    if (receipt.runtimeCodeHashAtCheckpoint &&
        receipt.runtimeCodeHashAtCheckpoint !== out.currentRuntimeHash) {
      out.warnings.push({
        code: "RUNTIME_CHANGED_SINCE_LAST_CHECKPOINT",
        message: "runtime code has changed since last checkpoint — expected mid-session; re-run `npm run brain:checkpoint` before declaring work done",
      })
    }
  } else {
    out.warnings.push({
      code: "NO_CHECKPOINT_YET",
      message: "this brain receipt has never witnessed a passing checkpoint — first patch must end with `npm run brain:checkpoint`",
    })
  }

  return out
}

function fmt(d) {
  if (!d) return "—"
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z"
}

function diffMinutes(later, earlier) {
  if (!later || !earlier) return null
  return Math.round((later.getTime() - earlier.getTime()) / 60000)
}

// Existence-check the 14 regression-matrix scripts referenced by MASTER_BRAIN.
function listRegressionMatrix() {
  const scriptsDir = path.join(BACKEND_ROOT, "scripts")
  if (!fs.existsSync(scriptsDir)) return []
  return fs.readdirSync(scriptsDir)
    .filter((f) => f.startsWith("verify") && f.endsWith(".js"))
    .sort()
}

module.exports = {
  BRAIN_DIR,
  BACKEND_ROOT,
  REPO_ROOT,
  BRAIN_FILES,
  BRAIN_REQUIRED_ON_PATCH,
  RUNTIME_CODE_DIRS,
  readBrainFile,
  brainFileStats,
  extractLastUpdated,
  extractCurrentProjectPhase,
  extractCurrentPriorities,
  extractDoNotReintroduce,
  extractSection,
  extractArchitectureLaws,
  extractOpenIncidents,
  extractRecentEvolutionEntries,
  mostRecentMtime,
  brainDirMostRecentMtime,
  runtimeCodeMostRecentMtime,
  listRegressionMatrix,
  fmt,
  diffMinutes,
  // continuity-state primitives
  BOOTSTRAP_RECEIPT_PATH,
  CONTINUITY_BOOTSTRAP_WARN_MINUTES,
  CONTINUITY_BOOTSTRAP_FAIL_MINUTES,
  CONTINUITY_RUNTIME_LAG_FAIL_MINUTES,
  hashFiles,
  listRuntimeCodeFiles,
  listBrainFilePaths,
  hashBrainDocs,
  hashRuntimeCode,
  readBootstrapReceipt,
  writeBootstrapReceipt,
  assessContinuity,
}
