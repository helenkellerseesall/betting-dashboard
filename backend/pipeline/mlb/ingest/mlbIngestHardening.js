"use strict"
// ============================================================================
// mlbIngestHardening — shared primitives for MLB ingest populators.
// ----------------------------------------------------------------------------
// Extracted from the proven batter-stats hardening (commit 35fab13). Each
// populator (batter/pitcher game logs, bullpen workload, pitcher stats) wires
// these with its own fetch + key + coverage semantics. The merge NEVER reduces
// coverage: a partial or fully-failed run KEEPS the prior data instead of
// overwriting it with a smaller map — the exact failure that silently dropped
// teams on flaky-API nights.
//
// ANTI-FABRICATION: a missing/corrupt prior file is its own finding (empty
// object), never defaulted to anything invented. The merge only ADDS/updates;
// it never blanks an existing entry.
// ============================================================================
const fs = require("fs")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Bounded retry — a transient statsapi timeout/5xx retries with linear backoff
// instead of silently dropping the team/player for the whole run.
async function withRetry(fn, { attempts = 3, backoffMs = 400, label = "fetch" } = {}) {
  let lastErr = null
  for (let i = 0; i < attempts; i++) {
    try { return await fn() }
    catch (e) { lastErr = e; if (i < attempts - 1) await sleep(backoffMs * (i + 1)) }
  }
  const err = new Error(`${label} failed after ${attempts} attempts: ${lastErr?.message || lastErr}`)
  err.cause = lastErr
  throw err
}

// Read an existing JSON object map; missing/corrupt ⇒ {} (honest empty start).
function loadJsonSafe(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"))
    return (j && typeof j === "object" && !Array.isArray(j)) ? j : null
  } catch (_) { return null }
}

// Merge this-run INTO prior: fresh entries overwrite, un-fetched prior entries
// kept. Returns the merged map + counts + a `shrank` flag (impossible with a
// spread, but the caller MUST refuse to persist if it is ever true).
function mergeNoShrink(priorMap, thisRunMap) {
  const prior = (priorMap && typeof priorMap === "object" && !Array.isArray(priorMap)) ? priorMap : {}
  const run = (thisRunMap && typeof thisRunMap === "object" && !Array.isArray(thisRunMap)) ? thisRunMap : {}
  const merged = { ...prior, ...run }
  const priorCount = Object.keys(prior).length
  const thisRunCount = Object.keys(run).length
  const mergedCount = Object.keys(merged).length
  const overlap = Object.keys(run).filter((k) => k in prior).length
  return {
    merged,
    priorCount,
    thisRunCount,
    mergedCount,
    retained: priorCount - overlap,     // prior entries not re-fetched this run (kept)
    shrank: mergedCount < priorCount,
  }
}

// Write a small sidecar meta JSON (coverage/freshness) next to the data file.
function writeMeta(file, meta) {
  try { fs.writeFileSync(file, JSON.stringify(meta, null, 2)); return true } catch (_) { return false }
}

module.exports = { withRetry, loadJsonSafe, mergeNoShrink, writeMeta }
