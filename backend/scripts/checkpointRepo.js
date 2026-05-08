#!/usr/bin/env node
"use strict"

/**
 * checkpointRepo.js — Session K
 *
 * Sandbox-safe checkpoint preparer for the Claude / virtiofs environment.
 *
 * THE PROBLEM:
 *   Claude's sandbox cannot unlink files under .git/ (virtiofs PermissionError).
 *   This means `git add` leaves .git/index.lock and `git commit` fails on the next run.
 *
 * THE SOLUTION:
 *   Claude prepares a checkpoint manifest. Operator finalizes from macOS terminal.
 *
 *   Claude runs:  node scripts/checkpointRepo.js "commit message here"
 *   Operator runs: bash scripts/finalizeCheckpoint.sh
 *
 * WHAT THIS SCRIPT DOES:
 *   - Collects current git diff/status information
 *   - Detects lock files and classifies them (stale vs active)
 *   - Writes .checkpoint/pending.json with everything needed for finalization
 *   - NEVER touches .git/ in any way
 *   - NEVER runs git add, git commit, or any write git operation
 *
 * WHAT THIS SCRIPT DOES NOT DO:
 *   - Does NOT modify .git/
 *   - Does NOT delete lock files
 *   - Does NOT stage or commit anything
 *   - Does NOT auto-push
 *
 * STALE LOCK DETECTION:
 *   A lock is classified stale if it is older than STALE_THRESHOLD_SECS (default 60s).
 *   The finalizeCheckpoint.sh script enforces an additional check (pgrep git) before removal.
 *
 * Usage:
 *   node scripts/checkpointRepo.js "your commit message"
 *   node scripts/checkpointRepo.js --show         (inspect pending checkpoint)
 *   node scripts/checkpointRepo.js --clear        (discard pending checkpoint)
 */

const fs   = require("fs")
const path = require("path")
const { execSync } = require("child_process")

// ── Config ────────────────────────────────────────────────────────────────────

const REPO_ROOT          = path.join(__dirname, "..", "..")
const CHECKPOINT_DIR     = path.join(REPO_ROOT, ".checkpoint")
const CHECKPOINT_FILE    = path.join(CHECKPOINT_DIR, "pending.json")
const GIT_DIR            = path.join(REPO_ROOT, ".git")
const STALE_THRESHOLD    = 60  // seconds — locks older than this are classified stale

// ── Utilities ─────────────────────────────────────────────────────────────────

function lockAgeSeconds(lockPath) {
  try {
    const stat = fs.statSync(lockPath)
    return Math.round((Date.now() - stat.mtimeMs) / 1000)
  } catch (_) {
    return null  // file does not exist
  }
}

function scanLocks() {
  const candidates = [
    ".git/index.lock",
    ".git/HEAD.lock",
  ]
  const result = []
  for (const rel of candidates) {
    const abs = path.join(REPO_ROOT, rel)
    const age = lockAgeSeconds(abs)
    if (age !== null) {
      result.push({
        path:     rel,
        ageSecs:  age,
        stale:    age >= STALE_THRESHOLD,
        status:   age >= STALE_THRESHOLD ? "STALE — safe to remove" : "ACTIVE — do not remove yet",
      })
    }
  }
  return result
}

function gitStatus() {
  try {
    const raw = execSync("git status --porcelain", {
      cwd:      REPO_ROOT,
      encoding: "utf8",
      timeout:  5000,
    })
    return raw.trim().split("\n").filter(Boolean)
  } catch (_) {
    return []
  }
}

function gitLog(n = 3) {
  try {
    return execSync(`git log --oneline -${n}`, {
      cwd:      REPO_ROOT,
      encoding: "utf8",
      timeout:  5000,
    }).trim()
  } catch (_) {
    return "(git log unavailable)"
  }
}

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd:      REPO_ROOT,
      encoding: "utf8",
      timeout:  5000,
    }).trim()
  } catch (_) {
    return "(unknown)"
  }
}

// ── Sub-commands ──────────────────────────────────────────────────────────────

function showCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    console.log("No pending checkpoint.")
    return
  }
  const cp = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"))
  console.log("\n── Pending Checkpoint ──────────────────────────────")
  console.log(`  Created:  ${cp.timestamp}`)
  console.log(`  Branch:   ${cp.branch}`)
  console.log(`  Message:  "${cp.message}"`)
  console.log(`  Files (${cp.files.length}):`)
  cp.files.forEach(f => console.log(`    ${f}`))
  if (cp.locks.length) {
    console.log(`  Locks at creation time:`)
    cp.locks.forEach(l => console.log(`    ${l.path} — ${l.ageSecs}s old — ${l.status}`))
  } else {
    console.log(`  Locks at creation time: none`)
  }
  console.log("\nFinalize with:  bash scripts/finalizeCheckpoint.sh")
  console.log("────────────────────────────────────────────────────\n")
}

function clearCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    console.log("No pending checkpoint to clear.")
    return
  }
  // Sandbox (virtiofs) cannot unlink files — operator must remove from macOS terminal.
  // We overwrite with a tombstone to mark it as discarded.
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ discarded: true, at: new Date().toISOString() }, null, 2))
  console.log("Checkpoint marked as discarded (virtiofs cannot unlink).")
  console.log("To fully remove, run from macOS terminal:")
  console.log("  rm .checkpoint/pending.json")
}

function prepareCheckpoint(message) {
  const locks  = scanLocks()
  const files  = gitStatus()
  const branch = currentBranch()
  const log    = gitLog(3)

  const checkpoint = {
    message,
    timestamp:  new Date().toISOString(),
    branch,
    files,
    locks,
    recentLog:  log,
  }

  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true })
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log("\n── Checkpoint Prepared ─────────────────────────────")
  console.log(`  File:     ${CHECKPOINT_FILE}`)
  console.log(`  Branch:   ${branch}`)
  console.log(`  Message:  "${message}"`)
  console.log(`  Changed files (${files.length}):`)
  if (files.length === 0) {
    console.log("    (no changes detected)")
  } else {
    files.forEach(f => console.log(`    ${f}`))
  }

  if (locks.length === 0) {
    console.log("  Locks:    none ✓")
  } else {
    console.log("  Locks detected:")
    for (const l of locks) {
      const icon = l.stale ? "⚠️  STALE" : "🔴 ACTIVE"
      console.log(`    ${icon} ${l.path} — ${l.ageSecs}s old`)
    }
  }

  console.log("\n  Recent commits:")
  log.split("\n").forEach(line => console.log(`    ${line}`))

  console.log("\n✓ Checkpoint ready. Finalize with:")
  console.log("    bash scripts/finalizeCheckpoint.sh")
  console.log("────────────────────────────────────────────────────\n")
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [,, ...args] = process.argv
const arg = (args[0] || "").trim()

if (arg === "--show") {
  showCheckpoint()
} else if (arg === "--clear") {
  clearCheckpoint()
} else if (arg.length > 0) {
  prepareCheckpoint(args.join(" ").trim())
} else {
  console.error([
    "",
    "Usage:",
    "  node scripts/checkpointRepo.js \"commit message\"   — prepare checkpoint",
    "  node scripts/checkpointRepo.js --show              — inspect pending checkpoint",
    "  node scripts/checkpointRepo.js --clear             — discard pending checkpoint",
    "",
    "Then finalize from macOS terminal:",
    "  bash scripts/finalizeCheckpoint.sh",
    "",
  ].join("\n"))
  process.exit(1)
}
