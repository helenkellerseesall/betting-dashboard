#!/usr/bin/env node
"use strict"

/**
 * cognitionRank.js — print BETTOR_BACKLOG entries ranked by composite
 * cognition priority. Single deterministic ranking formula. No LLM.
 *
 * Usage:
 *   node backend/scripts/ops/cognitionRank.js              # OPEN + IN-SLICE
 *   node backend/scripts/ops/cognitionRank.js --all
 *   node backend/scripts/ops/cognitionRank.js --category role-archetype
 *   node backend/scripts/ops/cognitionRank.js --top 5
 *
 * Ranking formula (Phase BC-1):
 *   score = priorityWeight + severityWeight + cognitionWeight
 *         + (feelsFakeFlag ? 5 : 0)
 *         + (linkedRisks.length × 2)
 *         + (screenshots.length × 1)
 *         + ((100 - realismScore) / 10)   if realismScore != null
 *
 * Phase BC-1 (2026-05-19).
 */

const fs   = require("fs")
const path = require("path")
const BACKLOG_PATH = path.join(__dirname, "..", "..", "..", "docs", "BETTOR_BACKLOG.md")

const PRIORITY_W = { "P0": 100, "P1": 60, "P2": 30, "P3": 10 }
const SEVERITY_W = { critical: 40, high: 25, medium: 12, low: 4 }

// Cognition-category weights — higher = more urgent product-direction work.
// Operator-cemented (2026-05-19) reflecting "battlefield → curated edge → AI
// compression" doctrine and the role/archetype-first leap-readiness emphasis.
const COGNITION_W = {
  "role-archetype":         30,
  "sportsbook":             24,
  "market-psychology":      22,
  "timing":                 18,
  "gameflow":               18,
  "ladder-realism":         18,
  "feels-fake":             18,
  "realism":                16,
  "superstar-gravity":      14,
  "no-name-overload":       14,
  "deep-cut-prop-ecology":  12,
  "cashout":                10,
  "fe-workflow":             8,
  "operational-friction":    8,
  "mobile-sportsbook-os":    6,
  "none":                    0,
}

function parseArgs(argv) {
  const out = { topN: Infinity, all: false, category: null }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--all")      out.all = true
    if (argv[i] === "--top")      out.topN = parseInt(argv[++i], 10) || 5
    if (argv[i] === "--category") out.category = argv[++i]
  }
  return out
}

function parseEntries(src) {
  const out = []
  const blocks = src.split(/^---\s*$/m).slice(1)
  for (const blk of blocks) {
    if (!/^id:\s*BBL-/m.test(blk)) continue
    const get = (k) => (blk.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1]?.trim()
    const arr = (k) => {
      const raw = get(k)
      if (!raw) return []
      const m = raw.match(/^\[(.*)\]$/)
      if (!m) return []
      return m[1].split(",").map(s => s.trim()).filter(Boolean)
    }
    out.push({
      id:                 get("id"),
      lane:               get("lane"),
      title:              get("title"),
      state:              get("state"),
      submitter:          get("submitter"),
      cognitionCategory:  get("cognitionCategory") || "none",
      sportsbookCategory: get("sportsbookCategory") || "none",
      uxTag:              get("uxTag") || "none",
      severity:           get("severity") || "medium",
      priority:           get("priority") || "P2",
      linkedRisks:        arr("linkedRisks"),
      screenshots:        arr("screenshots"),
      feelsFakeFlag:      get("feelsFakeFlag") === "true",
      realismScore:       (() => { const v = get("realismScore"); return v && v !== "null" ? Number(v) : null })(),
    })
  }
  return out
}

function scoreEntry(e) {
  let s = 0
  s += PRIORITY_W[e.priority] || 0
  s += SEVERITY_W[e.severity] || 0
  s += COGNITION_W[e.cognitionCategory] || 0
  if (e.feelsFakeFlag) s += 5
  s += (e.linkedRisks?.length || 0) * 2
  s += (e.screenshots?.length || 0) * 1
  if (e.realismScore !== null && Number.isFinite(e.realismScore)) {
    s += (100 - e.realismScore) / 10
  }
  return Math.round(s * 10) / 10
}

function main() {
  const args = parseArgs(process.argv)
  const src = fs.readFileSync(BACKLOG_PATH, "utf8")
  let entries = parseEntries(src)
  if (!args.all) entries = entries.filter(e => e.state === "OPEN" || e.state === "IN-SLICE")
  if (args.category) entries = entries.filter(e => e.cognitionCategory === args.category)

  const ranked = entries
    .map(e => ({ ...e, score: scoreEntry(e) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, args.topN)

  if (ranked.length === 0) { console.log("(no entries match)"); return }
  console.log("")
  console.log("score   id        pri  sev       cognition                 sportsbook    ux                title")
  console.log("------  --------  ---  --------  -----------------------  ------------- ----------------  ----------------------------------------------")
  for (const e of ranked) {
    console.log(
      String(e.score).padStart(6) + "  " +
      (e.id||"?").padEnd(10) +
      (e.priority||"?").padEnd(5) +
      (e.severity||"?").padEnd(10) +
      (e.cognitionCategory||"?").padEnd(25) +
      (e.sportsbookCategory||"none").padEnd(14) +
      (e.uxTag||"none").padEnd(18) +
      (e.title||"").slice(0, 46)
    )
  }
  console.log("")
}

if (require.main === module) main()
module.exports = { parseEntries, scoreEntry, COGNITION_W, PRIORITY_W, SEVERITY_W }
