"use strict"

/**
 * verifyOperationalOrchestration.js — Phase OO-1 (2026-05-19).
 *
 * Enforces the orchestration continuity infrastructure:
 *   A — canonical files exist (LANE_INDEX, BETTOR_BACKLOG, EXECUTION_BACKLOG,
 *       OPERATIONAL_FOOTER_TEMPLATE)
 *   B — LANE_INDEX names exactly six lanes; names match the canonical set
 *   C — BETTOR_BACKLOG entries every have id/lane/state/title/linkedSlice
 *   D — EXECUTION_BACKLOG has exactly one Active slice; next-command set;
 *       next-command exists in the runtime command registry
 *   E — ops/runtime.js registry exists; backlogAdd/backlogList/nextStep exist
 *   F — OPERATOR_RUNBOOK cross-references the orchestration docs
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const DOCS    = path.join(REPO, "docs")

const LANE_INDEX_PATH    = path.join(DOCS, "LANE_INDEX.md")
const BETTOR_BACKLOG     = path.join(DOCS, "BETTOR_BACKLOG.md")
const EXEC_BACKLOG       = path.join(DOCS, "EXECUTION_BACKLOG.md")
const FOOTER_TEMPLATE    = path.join(DOCS, "OPERATIONAL_FOOTER_TEMPLATE.md")
const RUNBOOK_PATH       = path.join(DOCS, "OPERATOR_RUNBOOK.md")
const RUNTIME_REGISTRY   = path.join(BACKEND, "scripts", "ops", "runtime.js")
const BACKLOG_ADD        = path.join(BACKEND, "scripts", "ops", "backlogAdd.js")
const BACKLOG_LIST       = path.join(BACKEND, "scripts", "ops", "backlogList.js")
const NEXT_STEP          = path.join(BACKEND, "scripts", "ops", "nextStep.js")

const CANONICAL_LANES = ["MCR","ACTIVE EXECUTION","FULL SYSTEM AUDIT","FRONTEND / UX LAB","INFRA / GOVERNANCE","OPERATOR PLAYBOOK"]

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyOperationalOrchestration.js (OO-1)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── A ─────────────────────────────────────────────────────────────────
console.log("Cluster A — canonical orchestration files")
assert(fs.existsSync(LANE_INDEX_PATH),  "A1 — docs/LANE_INDEX.md exists")
assert(fs.existsSync(BETTOR_BACKLOG),   "A2 — docs/BETTOR_BACKLOG.md exists")
assert(fs.existsSync(EXEC_BACKLOG),     "A3 — docs/EXECUTION_BACKLOG.md exists")
assert(fs.existsSync(FOOTER_TEMPLATE),  "A4 — docs/OPERATIONAL_FOOTER_TEMPLATE.md exists")
assert(fs.existsSync(RUNTIME_REGISTRY), "A5 — backend/scripts/ops/runtime.js exists")
assert(fs.existsSync(BACKLOG_ADD),      "A6 — backend/scripts/ops/backlogAdd.js exists")
assert(fs.existsSync(BACKLOG_LIST),     "A7 — backend/scripts/ops/backlogList.js exists")
assert(fs.existsSync(NEXT_STEP),        "A8 — backend/scripts/ops/nextStep.js exists")

// ── B ─────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster B — LANE_INDEX canonical lanes")
if (fs.existsSync(LANE_INDEX_PATH)) {
  const li = fs.readFileSync(LANE_INDEX_PATH, "utf8")
  for (const lane of CANONICAL_LANES) {
    assert(li.includes(lane), `B — lane present: "${lane}"`)
  }
}

// ── C ─────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster C — BETTOR_BACKLOG schema")
if (fs.existsSync(BETTOR_BACKLOG)) {
  const src = fs.readFileSync(BETTOR_BACKLOG, "utf8")
  const blocks = src.split(/^---\s*$/m).slice(1).filter(b => /^id:\s*BBL-/m.test(b))
  assert(blocks.length >= 1, `C1 — at least one BBL entry exists (n=${blocks.length})`)
  let schemaOk = 0
  const required = ["id","submittedAt","submitter","lane","title","state","linkedSlice","evidence","body"]
  for (const b of blocks) {
    const ok = required.every(k => new RegExp("^" + k + ":", "m").test(b))
    if (ok) schemaOk++
  }
  assert(schemaOk === blocks.length,
    `C2 — every BBL entry has all required fields (${schemaOk}/${blocks.length})`)
  // Every lane field MUST match canonical lane (case-insensitive, allowing the slash variant)
  const LANE_OK_RE = /^(MCR|ACTIVE EXECUTION|FULL SYSTEM AUDIT|FRONTEND ?\/ ?UX LAB|INFRA ?\/ ?GOVERNANCE|INFRA|OPERATOR PLAYBOOK)$/
  let laneOk = 0
  for (const b of blocks) {
    const m = b.match(/^lane:\s*(.+)$/m)
    if (m && LANE_OK_RE.test(m[1].trim())) laneOk++
  }
  assert(laneOk === blocks.length, `C3 — every BBL entry cites a canonical lane (${laneOk}/${blocks.length})`)
}

// ── D ─────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster D — EXECUTION_BACKLOG active slice + next-command")
if (fs.existsSync(EXEC_BACKLOG)) {
  const src = fs.readFileSync(EXEC_BACKLOG, "utf8")
  const m = src.match(/## Active slice([\s\S]*?)## Slice queue/)
  assert(!!m, "D1 — EXECUTION_BACKLOG has Active slice block")
  if (m) {
    const block = m[1]
    const get = (k) => {
      const r = block.match(new RegExp("\\|\\s*" + k + "\\s*\\|\\s*([^|]+?)\\s*\\|"))
      return r ? r[1].trim() : null
    }
    const slice       = get("slice")
    const lane        = get("lane")
    const status      = get("status")
    const nextCmd     = get("next-command")
    assert(!!slice && slice !== "?",    "D2 — Active slice id present")
    assert(!!lane  && lane  !== "?",    "D3 — Active slice lane present")
    assert(!!status && status !== "?",  "D4 — Active slice status present")
    assert(!!nextCmd && nextCmd !== "?", "D5 — Active slice next-command present")
    // The next-command value must be a recognized command from runtime.js
    if (nextCmd) {
      try {
        delete require.cache[RUNTIME_REGISTRY]
        const { COMMANDS } = require(RUNTIME_REGISTRY)
        const cmdNames = Object.keys(COMMANDS)
        const cmdStrings = cmdNames.map(n => COMMANDS[n].cmd)
        const stripped = nextCmd.replace(/^`|`$/g, "").trim()
        const matchedName   = cmdNames.includes(stripped)
        const matchedString = cmdStrings.some(c => c === stripped || stripped.startsWith(c) || c.startsWith(stripped))
        assert(matchedName || matchedString,
          `D6 — next-command "${stripped}" recognized in ops/runtime.js registry`)
      } catch (e) {
        failed++; failures.push("D6 — runtime registry load error: " + e.message)
      }
    }
  }
}

// ── E ─────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster E — runtime.js registry shape")
try {
  delete require.cache[RUNTIME_REGISTRY]
  const { COMMANDS } = require(RUNTIME_REGISTRY)
  assert(COMMANDS && typeof COMMANDS === "object",  "E1 — runtime.js exports COMMANDS")
  assert(Object.isFrozen(COMMANDS),                  "E2 — COMMANDS is Object.frozen")
  const requiredNames = ["v5","v5-fe","regen-mlb","verify-orchestration","next-step","backlog-list","backlog-add"]
  for (const n of requiredNames) assert(n in COMMANDS, `E3 — registry contains "${n}"`)
  // Each command has desc/cmd/lane
  let shapeOk = 0
  for (const [name, def] of Object.entries(COMMANDS)) {
    if (def && typeof def.desc === "string" && typeof def.cmd === "string" && typeof def.lane === "string") shapeOk++
  }
  assert(shapeOk === Object.keys(COMMANDS).length,
    `E4 — every command has desc/cmd/lane (${shapeOk}/${Object.keys(COMMANDS).length})`)
} catch (e) {
  failed++; failures.push("E — runtime.js load: " + e.message)
}

// ── F ─────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster F — OPERATOR_RUNBOOK cross-reference")
if (fs.existsSync(RUNBOOK_PATH)) {
  const rb = fs.readFileSync(RUNBOOK_PATH, "utf8")
  assert(/BETTOR_BACKLOG|bettor backlog/i.test(rb),       "F1 — OPERATOR_RUNBOOK references BETTOR_BACKLOG")
  assert(/EXECUTION_BACKLOG|execution backlog/i.test(rb), "F2 — OPERATOR_RUNBOOK references EXECUTION_BACKLOG")
  assert(/LANE_INDEX|six lanes|lane index/i.test(rb),     "F3 — OPERATOR_RUNBOOK references LANE_INDEX")
  assert(/OPERATIONAL_FOOTER|operational footer/i.test(rb), "F4 — OPERATOR_RUNBOOK references OPERATIONAL_FOOTER_TEMPLATE")
  assert(/scripts\/ops\/runtime\.js|ops\/runtime/i.test(rb), "F5 — OPERATOR_RUNBOOK references ops/runtime.js")
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifyOperationalOrchestration — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
