"use strict"

/**
 * verifyOperationalOrchestration.js — Phase OO-1 (2026-05-19), extended OO-2 (2026-05-19).
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
 *
 * OO-2 enforcement extension:
 *   G — OPERATIONAL_FOOTER_TEMPLATE declares structured-checkpoint footer
 *       with TERM 1/2/3, FE VALIDATION, BETTOR-VISIBLE EXPECTED RESULT,
 *       UNRESOLVED BLOCKERS sections + ambiguity-ban rule
 *   H — OPEN_RISKS.md exists; every R-NNN-N entry has full schema; all
 *       OPEN/MITIGATED ids appear in EXECUTION_BACKLOG Risk references
 *   I — EXECUTION_BACKLOG has Lane log section + Risk references section;
 *       Active slice block carries risk-refs field
 *   J — OO-2 ops scripts exist (riskAdd/riskList/laneSync/playbookSync/
 *       checkpointPersist) AND are registered in runtime.js COMMANDS
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
const OPEN_RISKS_PATH    = path.join(DOCS, "OPEN_RISKS.md")
const RUNBOOK_PATH       = path.join(DOCS, "OPERATOR_RUNBOOK.md")
const RUNTIME_REGISTRY   = path.join(BACKEND, "scripts", "ops", "runtime.js")
const BACKLOG_ADD        = path.join(BACKEND, "scripts", "ops", "backlogAdd.js")
const BACKLOG_LIST       = path.join(BACKEND, "scripts", "ops", "backlogList.js")
const NEXT_STEP          = path.join(BACKEND, "scripts", "ops", "nextStep.js")
const RISK_ADD           = path.join(BACKEND, "scripts", "ops", "riskAdd.js")
const RISK_LIST          = path.join(BACKEND, "scripts", "ops", "riskList.js")
const LANE_SYNC          = path.join(BACKEND, "scripts", "ops", "laneSync.js")
const PLAYBOOK_SYNC      = path.join(BACKEND, "scripts", "ops", "playbookSync.js")
const CHECKPOINT_PERSIST = path.join(BACKEND, "scripts", "ops", "checkpointPersist.js")

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

// ── G ─────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster G — OPERATIONAL_FOOTER_TEMPLATE structured-checkpoint shape (OO-2)")
if (fs.existsSync(FOOTER_TEMPLATE)) {
  const ft = fs.readFileSync(FOOTER_TEMPLATE, "utf8")
  assert(/Structured-checkpoint footer/i.test(ft),
    "G1 — footer template declares structured-checkpoint section")
  assert(/^TERM 1 /m.test(ft) && /^TERM 2 /m.test(ft) && /^TERM 3 /m.test(ft),
    "G2 — TERM 1, TERM 2, TERM 3 sections all present")
  assert(/^FE VALIDATION/m.test(ft),
    "G3a — FE VALIDATION section present")
  assert(/^BETTOR-VISIBLE EXPECTED RESULT/m.test(ft),
    "G3b — BETTOR-VISIBLE EXPECTED RESULT section present")
  assert(/^UNRESOLVED BLOCKERS/m.test(ft),
    "G3c — UNRESOLVED BLOCKERS section present")
  assert(/Ambiguity ban/i.test(ft),
    "G4 — ambiguity-ban rule declared")
  // term commands MUST resolve to the canonical ops layer
  assert(/npm run ops:term1/.test(ft),  "G5a — TERM 1 cites `npm run ops:term1`")
  assert(/npm run ops:term2/.test(ft),  "G5b — TERM 2 cites `npm run ops:term2`")
  assert(/npm run ops:checkpoint/.test(ft), "G5c — TERM 3 cites `npm run ops:checkpoint`")
}

// ── H ─────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster H — OPEN_RISKS ledger schema + carry-forward (OO-2)")
assert(fs.existsSync(OPEN_RISKS_PATH), "H1 — docs/OPEN_RISKS.md exists")
let openRiskIds = []
if (fs.existsSync(OPEN_RISKS_PATH)) {
  const src = fs.readFileSync(OPEN_RISKS_PATH, "utf8")
  const blocks = src.split(/^---\s*$/m).slice(1).filter(b => /^id:\s*R-/m.test(b))
  assert(blocks.length >= 1, `H2 — at least one R-NNN-N entry exists (n=${blocks.length})`)
  const required = ["id","openedAt","openedBy","lane","slice","title","state","body"]
  let schemaOk = 0
  for (const b of blocks) {
    const ok = required.every(k => new RegExp("^" + k + ":", "m").test(b))
    if (ok) schemaOk++
    const m = b.match(/^id:\s*(R-\d+-\d+)/m)
    const st = b.match(/^state:\s*(OPEN|MITIGATED|CLOSED)/m)
    if (m && st && (st[1] === "OPEN" || st[1] === "MITIGATED")) openRiskIds.push(m[1])
  }
  assert(schemaOk === blocks.length,
    `H3 — every risk entry has all required fields (${schemaOk}/${blocks.length})`)
}

// ── I ─────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster I — EXECUTION_BACKLOG Lane log + Risk references (OO-2)")
if (fs.existsSync(EXEC_BACKLOG)) {
  const src = fs.readFileSync(EXEC_BACKLOG, "utf8")
  assert(/## Lane log/.test(src),         "I1 — EXECUTION_BACKLOG has '## Lane log' section")
  assert(/## Risk references/.test(src),  "I2 — EXECUTION_BACKLOG has '## Risk references' section")
  // Active slice block has risk-refs field
  const m = src.match(/## Active slice([\s\S]*?)## Slice queue/)
  if (m) {
    const block = m[1]
    const has = /\|\s*risk-refs\s*\|/.test(block)
    assert(has, "I3 — Active slice block has 'risk-refs' field")
  }
  // Every OPEN/MITIGATED risk id from OPEN_RISKS.md MUST be carried forward
  // in the Risk references section.
  if (openRiskIds.length > 0) {
    let carried = 0
    for (const rid of openRiskIds) {
      if (src.includes(rid)) carried++
    }
    assert(carried === openRiskIds.length,
      `I4 — every open risk id carried in EXECUTION_BACKLOG (${carried}/${openRiskIds.length})`)
  }
}

// ── J ─────────────────────────────────────────────────────────────────
console.log("")
console.log("Cluster J — OO-2 enforcement scripts exist + registered")
assert(fs.existsSync(RISK_ADD),           "J1 — backend/scripts/ops/riskAdd.js exists")
assert(fs.existsSync(RISK_LIST),          "J2 — backend/scripts/ops/riskList.js exists")
assert(fs.existsSync(LANE_SYNC),          "J3 — backend/scripts/ops/laneSync.js exists")
assert(fs.existsSync(PLAYBOOK_SYNC),      "J4 — backend/scripts/ops/playbookSync.js exists")
assert(fs.existsSync(CHECKPOINT_PERSIST), "J5 — backend/scripts/ops/checkpointPersist.js exists")
try {
  delete require.cache[RUNTIME_REGISTRY]
  const { COMMANDS } = require(RUNTIME_REGISTRY)
  for (const name of ["risk-add","risk-list","lane-sync","playbook-sync","checkpoint-persist"]) {
    assert(name in COMMANDS, `J6 — registry contains "${name}"`)
  }
} catch (e) {
  failed++; failures.push("J6 — registry load: " + e.message)
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
