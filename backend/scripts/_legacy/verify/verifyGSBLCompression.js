"use strict"

/**
 * verifyGSBLCompression.js — Phase GSBL Phase A (verifier-first; 2026-05-20).
 *
 * Enforces GSBL.md as a deterministic-session-reconstruction POINTER
 * INDEX, NOT a content store. Hard 300-line cap. Anti-bloat / anti-
 * narrative / anti-personality / anti-roleplay / pointer-not-content.
 *
 * Assertion clusters:
 *   A — STRUCTURAL: GSBL.md exists at repo root
 *   B — COMPRESSION: total lines ≤ 300 (hard cap)
 *   C — ANTI-BLOAT pattern detection (no narrative essays, no historical
 *       phase recap, no chat-history references)
 *   D — NO PERSONALITY / ROLEPLAY canon (no "I am", "as the assistant",
 *       no character framing)
 *   E — POINTER-NOT-CONTENT enforcement (canonical paths cited; no
 *       duplicated content from canonical files)
 *   F — REQUIRED STRUCTURAL SECTIONS present (canonical pointers, startup
 *       sequence, canonical commands, forbidden list, rollback boundary,
 *       Phase C readiness placeholder)
 *   G — NO HIDDEN RUNTIME AUTHORITY (no JS code blocks claiming behavior
 *       beyond documentation; no fake permanent memory claims)
 *   H — RUNTIME REGISTRY: verify-gsbl-compression command registered
 *
 * Doctrine: hard fail on any violation. GSBL is a discipline file, not
 * an evolving narrative.
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")
const GSBL_PATH = path.join(REPO, "GSBL.md")
const RUNTIME_REGISTRY = path.join(BACKEND, "scripts", "ops", "runtime.js")

const HARD_LINE_CAP = 300

let passed = 0, failed = 0
const failures = []
function assert(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); return }
  failed++; failures.push(label); console.error("  ✗ " + label)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log("  verifyGSBLCompression.js  (GSBL Phase A)")
console.log("════════════════════════════════════════════════════════════════════")
console.log("")

// ── A ────────────────────────────────────────────────────────────────────
console.log("Cluster A — STRUCTURAL")
assert(fs.existsSync(GSBL_PATH), "A1 — GSBL.md exists at repo root")

const src = fs.existsSync(GSBL_PATH) ? fs.readFileSync(GSBL_PATH, "utf8") : ""
const lines = src.split("\n")

// ── B — COMPRESSION ──────────────────────────────────────────────────────
console.log("")
console.log("Cluster B — COMPRESSION (≤ " + HARD_LINE_CAP + " lines)")
assert(lines.length <= HARD_LINE_CAP,
  `B1 — GSBL.md is ≤ ${HARD_LINE_CAP} lines (current: ${lines.length})`)

// ── C — ANTI-BLOAT pattern detection ─────────────────────────────────────
console.log("")
console.log("Cluster C — ANTI-BLOAT pattern detection")
// Narrative essay markers (long-form storytelling about prior phases)
const NARRATIVE_RE = /\b(once upon|in the beginning|previously,? we|long ago|history of|narrative|chronicle|saga|memoir)\b/i
assert(!NARRATIVE_RE.test(src),
  "C1 — no narrative essay markers (once upon / previously we / history of / saga / memoir)")
// Chat-history-as-source-of-truth
const CHAT_HISTORY_RE = /\b(in the prior chat|previous conversation|as we discussed|earlier you said|the operator told me|in chat)\b/i
assert(!CHAT_HISTORY_RE.test(src),
  "C2 — no chat-history references (prior chat / earlier you said / in conversation)")
// Phase recap as long-form prose (allowed in EXECUTION_BACKLOG shipped table;
// forbidden here). Markdown tables (lines starting with `|`) and fenced code
// blocks (```) are structured POINTER content, NOT prose — exclude both.
const longProseParagraphs = src.split(/\n\s*\n/).filter(p => {
  if (p.length <= 600) return false
  const trimmed = p.trim()
  // Exclude markdown tables — any paragraph whose lines mostly start with `|`
  const lines = trimmed.split("\n")
  const tableLines = lines.filter(l => /^\s*\|/.test(l)).length
  if (tableLines / lines.length > 0.5) return false
  // Exclude fenced code blocks
  if (/```[\s\S]*```/.test(trimmed)) return false
  // Exclude paragraphs that are mostly bullet lists
  const bulletLines = lines.filter(l => /^\s*[-*]/.test(l)).length
  if (bulletLines / lines.length > 0.4) return false
  // Exclude paragraphs that are mostly inline code citations (e.g. command lists)
  const codeBacktickRatio = (trimmed.match(/`/g) || []).length / trimmed.length
  if (codeBacktickRatio > 0.04) return false
  return true
})
assert(longProseParagraphs.length === 0,
  `C3 — no prose paragraph > 600 chars (found: ${longProseParagraphs.length}; tables/code/lists exempt)`)

// ── D — NO PERSONALITY / ROLEPLAY ────────────────────────────────────────
console.log("")
console.log("Cluster D — NO PERSONALITY / ROLEPLAY canon")
// First-person "I am" / "I'm the" / character framing
const PERSONALITY_RE = /\b(I am|I'm the|as the assistant|as the operator's|my role is|my personality|character canon|persona)\b/i
assert(!PERSONALITY_RE.test(src),
  "D1 — no first-person personality framing (I am / I'm the / as the assistant)")
// Roleplay markers
const ROLEPLAY_RE = /\b(\*[a-z][^*]+\*|<roleplay|character: |playing the role|act as)\b/i
assert(!ROLEPLAY_RE.test(src),
  "D2 — no roleplay markers (*action text* / act as / playing the role)")
// Greeting / sign-off (boilerplate session-start chatter)
const GREETING_RE = /\b(hi there|hello,?\s+(?:assistant|gpt|claude)|welcome,?\s+back)\b/i
assert(!GREETING_RE.test(src),
  "D3 — no greeting / sign-off boilerplate")

// ── E — POINTER-NOT-CONTENT ──────────────────────────────────────────────
console.log("")
console.log("Cluster E — POINTER-NOT-CONTENT enforcement")
// Must cite at least 5 canonical paths
const CANONICAL_PATH_RE = /(docs\/|backend\/|frontend\/|PRODUCT_IDENTITY\.md|ACTIVE_PHASE\.md|GSBL\.md)/g
const pathCitations = src.match(CANONICAL_PATH_RE) || []
assert(pathCitations.length >= 10,
  `E1 — GSBL cites ≥ 10 canonical paths (found: ${pathCitations.length})`)
// Must NOT include long verbatim quotes from canonical files (heuristic: any
// section block (between ## headers) > 50 lines is suspicious of content-
// duplication; structural lists are short).
const sectionsTooLong = src.split(/^##\s+/m).filter(s => s.split("\n").length > 80)
assert(sectionsTooLong.length === 0,
  `E2 — no section block > 80 lines (found: ${sectionsTooLong.length}; pointer not content)`)

// ── F — REQUIRED STRUCTURAL SECTIONS ─────────────────────────────────────
console.log("")
console.log("Cluster F — REQUIRED STRUCTURAL SECTIONS")
const REQUIRED = [
  ["Canonical authority pointers",   /## Canonical authority pointers/i],
  ["Startup sequence shell",          /## Startup sequence shell/i],
  ["Canonical commands",              /## Canonical commands/i],
  ["Operator interaction canon",      /## Operator interaction canon/i],
  ["Forbidden in this file",          /## Forbidden in this file/i],
  ["Rollback boundary",               /## Rollback boundary/i],
  ["Phase C readiness criteria",      /## Phase C readiness criteria/i],
]
for (const [label, re] of REQUIRED) assert(re.test(src), `F — section "${label}" present`)

// ── G — NO HIDDEN RUNTIME AUTHORITY ──────────────────────────────────────
console.log("")
console.log("Cluster G — NO HIDDEN RUNTIME AUTHORITY")
// No fenced JS code blocks with side-effect / require / fs operations
const jsBlocks = src.match(/```(?:js|javascript|node)\n[\s\S]*?```/g) || []
const sideEffectRe = /\b(require\s*\(|fs\.|http\.|spawn|exec|process\.)/
const sideEffectBlocks = jsBlocks.filter(b => sideEffectRe.test(b))
assert(sideEffectBlocks.length === 0,
  `G1 — no js code blocks with require / fs / http / spawn / exec (found: ${sideEffectBlocks.length})`)
// No fake permanent memory claims
const FAKE_MEMORY_RE = /\b(permanent memory|persistent memory across|i remember|i recall|memory of the operator|remembers what)\b/i
assert(!FAKE_MEMORY_RE.test(src),
  "G2 — no fake permanent-memory claims (state lives in canonical files)")
// No dynamic regeneration daemon claims
const REGEN_DAEMON_RE = /\b(auto[- ]?regenerate|self[- ]?update|daemon writes? this|generated automatically)\b/i
assert(!REGEN_DAEMON_RE.test(src),
  "G3 — no dynamic regeneration daemon claims")

// ── H — RUNTIME REGISTRY ─────────────────────────────────────────────────
console.log("")
console.log("Cluster H — RUNTIME REGISTRY")
try {
  delete require.cache[RUNTIME_REGISTRY]
  const { COMMANDS } = require(RUNTIME_REGISTRY)
  assert("verify-gsbl-compression" in COMMANDS, "H1 — runtime.js registers verify-gsbl-compression")
} catch (e) {
  failed++; failures.push("H1 — registry load: " + e.message)
}

console.log("")
console.log("════════════════════════════════════════════════════════════════════")
console.log(`  verifyGSBLCompression — passed=${passed} failed=${failed}`)
console.log("════════════════════════════════════════════════════════════════════")
if (failed > 0) {
  for (const f of failures) console.error("  - " + f)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
