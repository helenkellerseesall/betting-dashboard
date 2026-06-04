"use strict"

/**
 * schemaGoldenValidator.js — Wave 1 A3 (Repo Discovery Audit synthesis, item A3)
 *
 * Warn-only schema validation for the five core persistent JSON shapes:
 *   personal_ledger · tracked_bets · tracked_best · family_calibration · lessons
 *
 * DOCTRINE (operator-approved 2026-06-04): WARN + SURFACE, never block.
 *   - This validator NEVER throws and NEVER halts a write. It is read-only
 *     observability. A false positive here can flag for the operator but can
 *     NEVER stop a populator mid-slate ("never miss a day").
 *   - Anti-fabrication: a missing file is reported AS missing (its own
 *     warning), a parse failure AS a parse failure. Never defaulted to "OK".
 *     (Trust-mirror doctrine — every surface traces to a real source.)
 *
 * Golden specs are data files in ./goldenSchemas/*.golden.json so the contract
 * can be edited without touching code. Each spec declares the file target, the
 * expected root type, and presence+type checks for load-bearing keys only
 * (nullable/optional context signals are intentionally NOT required — their
 * absence is a known wiring gap, not corruption).
 */

const fs = require("fs")
const path = require("path")

// backend/ root — this file lives at backend/pipeline/shared/
const BACKEND_ROOT = path.resolve(__dirname, "..", "..")
const GOLDEN_DIR = path.join(__dirname, "goldenSchemas")

function typeName(v) {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

// Navigate a dot-path from an object. "$" (or "") returns the root itself.
function getByPath(root, p) {
  if (!p || p === "$") return root
  let cur = root
  for (const seg of p.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = cur[seg]
  }
  return cur
}

// Evenly sample up to n indices across an array length.
function sampleIndices(len, n) {
  if (len <= n) {
    const all = []
    for (let i = 0; i < len; i++) all.push(i)
    return all
  }
  const out = []
  const step = (len - 1) / (n - 1)
  for (let i = 0; i < n; i++) out.push(Math.round(i * step))
  return Array.from(new Set(out))
}

function v(severity, where, msg) {
  return { severity, where, msg }
}

// Check an object's required keys: presence + allowed type. Pushes violations.
function checkRequiredKeys(obj, requiredKeys, wherePrefix, violations) {
  for (const key of Object.keys(requiredKeys)) {
    const allowed = requiredKeys[key]
    if (!(key in obj)) {
      violations.push(v("missing_key", wherePrefix + key, "required key absent"))
      continue
    }
    const tn = typeName(obj[key])
    if (allowed.indexOf(tn) === -1) {
      violations.push(
        v("type_drift", wherePrefix + key, "type " + tn + " not in [" + allowed.join("|") + "]")
      )
    }
  }
}

function loadGoldens() {
  let files
  try {
    files = fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".golden.json"))
  } catch (e) {
    return { error: "cannot read golden dir " + GOLDEN_DIR + ": " + e.message, goldens: [] }
  }
  const goldens = []
  for (const f of files.sort()) {
    try {
      goldens.push(JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, f), "utf8")))
    } catch (e) {
      goldens.push({ name: f, _loadError: e.message })
    }
  }
  return { error: null, goldens }
}

// Resolve a golden's target spec into a list of { label, absPath, missing }.
function resolveTargets(target) {
  if (!target || !target.kind) return [{ label: "(no target)", absPath: null, missing: true }]
  if (target.kind === "static") {
    const abs = path.join(BACKEND_ROOT, target.path)
    return [{ label: target.path, absPath: abs, missing: !fs.existsSync(abs) }]
  }
  if (target.kind === "newestByPrefix") {
    const dirAbs = path.join(BACKEND_ROOT, target.dir)
    let entries = []
    try {
      entries = fs.readdirSync(dirAbs)
    } catch (e) {
      return (target.prefixes || []).map((p) => ({
        label: target.dir + "/" + p + "*",
        absPath: null,
        missing: true,
      }))
    }
    const out = []
    for (const prefix of target.prefixes || []) {
      const matches = entries
        .filter((f) => f.startsWith(prefix) && f.endsWith(target.suffix || ""))
        // Skip debris/sentinels (e.g. *_9999-12-31.json) so they don't sort as "newest".
        .filter((f) => !(target.exclude || []).some((x) => f.indexOf(x) !== -1))
        .sort() // dated filenames sort lexically; last = newest
      if (matches.length === 0) {
        out.push({ label: target.dir + "/" + prefix + "*", absPath: null, missing: true })
      } else {
        const newest = matches[matches.length - 1]
        out.push({ label: target.dir + "/" + newest, absPath: path.join(dirAbs, newest), missing: false })
      }
    }
    return out
  }
  return [{ label: "(unknown target kind: " + target.kind + ")", absPath: null, missing: true }]
}

/**
 * Cheap signature of all source files the check would read (resolved filename +
 * mtime + size, no parse). Lets a caller cache runSchemaGoldenCheck() and
 * recompute only when a source file actually changes — instead of a blind TTL.
 * Resolving + statvfs is microseconds; parsing the 65 MB ledger is the cost we
 * skip when nothing changed.
 */
function getSourceSignature() {
  let wrap
  try {
    wrap = loadGoldens()
  } catch (e) {
    return "golden-load-throw:" + e.message
  }
  if (wrap.error) return "golden-dir-error:" + wrap.error
  const parts = []
  for (const g of wrap.goldens) {
    if (g._loadError) {
      parts.push((g.name || "?") + ":golden-load-fail")
      continue
    }
    let targets
    try {
      targets = resolveTargets(g.target)
    } catch (e) {
      parts.push((g.name || "?") + ":resolve-fail")
      continue
    }
    for (const t of targets) {
      if (!t.absPath || t.missing) {
        parts.push(t.label + ":missing")
        continue
      }
      try {
        const st = fs.statSync(t.absPath)
        parts.push(t.label + ":" + st.mtimeMs + ":" + st.size)
      } catch (e) {
        parts.push(t.label + ":stat-fail")
      }
    }
  }
  return parts.sort().join("|")
}

function validateOneTarget(golden, tgt) {
  const res = { file: tgt.label, exists: !tgt.missing, parsed: false, violations: [] }
  if (tgt.missing || !tgt.absPath) {
    res.violations.push(v("file_missing", tgt.label, "expected file not found"))
    return res
  }
  let raw
  try {
    raw = fs.readFileSync(tgt.absPath, "utf8")
  } catch (e) {
    res.violations.push(v("read_fail", tgt.label, e.message))
    return res
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch (e) {
    res.violations.push(v("parse_fail", tgt.label, "invalid JSON: " + e.message))
    return res
  }
  res.parsed = true

  // Root type
  const rootType = typeName(data)
  if (golden.root && rootType !== golden.root) {
    res.violations.push(v("root_drift", "$", "root is " + rootType + ", expected " + golden.root))
    return res // shape diverged at the root — deeper checks would be noise
  }

  const c = golden.checks || {}

  // Top-level required keys (object roots)
  if (c.requiredTopKeys && rootType === "object") {
    checkRequiredKeys(data, c.requiredTopKeys, "", res.violations)
  }

  // Single nested objects (e.g. bankroll, analytics.totals, metadata)
  for (const spec of c.objects || []) {
    const node = getByPath(data, spec.path)
    if (typeName(node) !== "object") {
      res.violations.push(v("missing_key", spec.path, "expected object, got " + typeName(node)))
      continue
    }
    checkRequiredKeys(node, spec.requiredKeys || {}, spec.path + ".", res.violations)
  }

  // Object-of-records maps (e.g. family_calibration.sports.nba)
  for (const spec of c.objectMaps || []) {
    const node = getByPath(data, spec.path)
    if (typeName(node) !== "object") {
      res.violations.push(v("missing_key", spec.path, "expected object map, got " + typeName(node)))
      continue
    }
    const keys = Object.keys(node).slice(0, spec.sampleN || 12)
    for (const k of keys) {
      const rec = node[k]
      if (typeName(rec) !== "object") {
        res.violations.push(v("type_drift", spec.path + "." + k, "record is " + typeName(rec) + ", expected object"))
        continue
      }
      checkRequiredKeys(rec, spec.recordKeys || {}, spec.path + ".<*>.", res.violations)
    }
  }

  // Arrays of records (root array "$", or nested like entries / bets)
  for (const spec of c.arrays || []) {
    const node = getByPath(data, spec.path)
    if (typeName(node) !== "array") {
      res.violations.push(v("missing_key", spec.path, "expected array, got " + typeName(node)))
      continue
    }
    const idxs = sampleIndices(node.length, spec.sampleN || 60)
    for (const i of idxs) {
      const el = node[i]
      if (typeName(el) !== "object") {
        res.violations.push(v("type_drift", spec.path + "[" + i + "]", "element is " + typeName(el) + ", expected object"))
        continue
      }
      checkRequiredKeys(el, spec.requiredKeys || {}, spec.path + "[].", res.violations)
    }
  }

  // Collapse duplicate violations (same where+msg repeated across sampled rows).
  const seen = {}
  res.violations = res.violations.filter((x) => {
    const sig = x.severity + "|" + x.where + "|" + x.msg
    if (seen[sig]) return false
    seen[sig] = true
    return true
  })
  return res
}

function runSchemaGoldenCheck() {
  const out = { generatedAt: new Date().toISOString(), results: [], summary: {} }
  let goldensWrap
  try {
    goldensWrap = loadGoldens()
  } catch (e) {
    out.summary = { status: "error", message: "validator crashed loading goldens: " + e.message }
    return out
  }
  if (goldensWrap.error) {
    out.summary = { status: "error", message: goldensWrap.error }
    return out
  }

  let filesChecked = 0
  let filesMissing = 0
  let filesParseFail = 0
  let driftFiles = 0
  let totalViolations = 0

  for (const golden of goldensWrap.goldens) {
    const entry = { name: golden.name || "(unnamed)", title: golden.title || "", targets: [] }
    if (golden._loadError) {
      entry.targets.push({ file: golden.name, exists: false, parsed: false, violations: [v("golden_load_fail", golden.name, golden._loadError)] })
      out.results.push(entry)
      continue
    }
    let targets
    try {
      targets = resolveTargets(golden.target)
    } catch (e) {
      entry.targets.push({ file: "(resolve failed)", exists: false, parsed: false, violations: [v("resolve_fail", golden.name, e.message)] })
      out.results.push(entry)
      continue
    }
    for (const tgt of targets) {
      let r
      try {
        r = validateOneTarget(golden, tgt)
      } catch (e) {
        // Defensive: a bug in the validator must not throw — record it.
        r = { file: tgt.label, exists: !tgt.missing, parsed: false, violations: [v("validator_error", tgt.label, e.message)] }
      }
      filesChecked++
      if (r.violations.some((x) => x.severity === "file_missing")) filesMissing++
      if (r.violations.some((x) => x.severity === "parse_fail" || x.severity === "read_fail")) filesParseFail++
      if (r.violations.length > 0) driftFiles++
      totalViolations += r.violations.length
      entry.targets.push(r)
    }
    out.results.push(entry)
  }

  out.summary = {
    status: totalViolations === 0 ? "clean" : "drift",
    filesChecked,
    filesMissing,
    filesParseFail,
    driftFiles,
    totalViolations,
  }
  return out
}

module.exports = {
  runSchemaGoldenCheck,
  getSourceSignature,
  _internal: { typeName, getByPath, validateOneTarget, resolveTargets },
}
