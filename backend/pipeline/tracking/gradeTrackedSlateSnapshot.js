"use strict"

const fs = require("fs/promises")
const path = require("path")

const RUNTIME_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

function toDateKey(dateLike) {
  if (typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike
  return new Date().toISOString().slice(0, 10)
}

function norm(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
}

function toNumOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function settleFromActual({ side, line, actualValue }) {
  const s = norm(side)
  const ln = toNumOrNull(line)
  const act = toNumOrNull(actualValue)
  if (act == null) return { status: "open", result: "pending" }

  // Support the common patterns we already emit.
  // If we can't be confident, keep pending.
  if (s === "over" && ln != null) {
    if (act > ln) return { status: "settled", result: "win" }
    if (act === ln) return { status: "settled", result: "push" }
    return { status: "settled", result: "loss" }
  }
  if (s === "under" && ln != null) {
    if (act < ln) return { status: "settled", result: "win" }
    if (act === ln) return { status: "settled", result: "push" }
    return { status: "settled", result: "loss" }
  }

  // Binary yes/no (common for HR yes).
  if ((s === "yes" || s === "to hit" || s === "hit") && ln == null) {
    return act >= 1 ? { status: "settled", result: "win" } : { status: "settled", result: "loss" }
  }
  if ((s === "no") && ln == null) {
    return act >= 1 ? { status: "settled", result: "loss" } : { status: "settled", result: "win" }
  }

  return { status: "open", result: "pending" }
}

async function ensureRuntimeDir() {
  await fs.mkdir(RUNTIME_DIR, { recursive: true })
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Phase-1 grading:
 * - Reads tracked_props_<date>.json
 * - Attempts to settle rows ONLY when a trustworthy `actualValue` exists
 * - Otherwise leaves rows as open/pending
 */
async function gradeTrackedSlateSnapshot({ date }) {
  const slateDate = toDateKey(date)
  await ensureRuntimeDir()

  const trackedPath = path.join(RUNTIME_DIR, `tracked_props_${slateDate}.json`)
  const gradedPath = path.join(RUNTIME_DIR, `graded_props_${slateDate}.json`)

  const tracked = await readJsonIfExists(trackedPath)
  if (!tracked || !Array.isArray(tracked?.allTrackedProps)) {
    return {
      ok: false,
      slateDate,
      error: "tracked file missing or invalid",
      trackedPath,
      gradedPath
    }
  }

  const generatedAt = new Date().toISOString()
  const rowsIn = tracked.allTrackedProps

  let settled = 0
  let pending = 0

  const gradedRows = rowsIn.map((r) => {
    const existingStatus = String(r?.status || "").toLowerCase()
    const existingResult = String(r?.result || "").toLowerCase()

    // Respect already-settled rows if present.
    if (existingStatus === "settled" && ["win", "loss", "push", "void"].includes(existingResult)) {
      settled += 1
      return { ...r }
    }

    const { status, result } = settleFromActual({
      side: r?.side,
      line: r?.line,
      actualValue: r?.actualValue
    })

    if (status === "settled") settled += 1
    else pending += 1

    return { ...r, status, result }
  })

  const payload = {
    metadata: {
      slateDate,
      generatedAt,
      sourceTrackedPath: trackedPath,
      version: "tracking-phase-1"
    },
    gradedProps: gradedRows,
    diagnostics: {
      total: gradedRows.length,
      settled,
      pending
    }
  }

  await fs.writeFile(gradedPath, JSON.stringify(payload, null, 2), "utf8")
  return { ok: true, slateDate, path: gradedPath, diagnostics: payload.diagnostics }
}

module.exports = { gradeTrackedSlateSnapshot }

