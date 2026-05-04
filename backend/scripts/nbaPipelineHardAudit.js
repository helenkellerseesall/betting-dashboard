#!/usr/bin/env node
"use strict"

/**
 * NBA pipeline HARD audit: Phase-1 ingest counts → model → slips.
 * Runs the full stack twice; both passes must be clean (blocking rules).
 *
 * Usage: node backend/scripts/nbaPipelineHardAudit.js [path/to/snapshot.json]
 * Exit 0 = two clean passes. Exit 1 = ingest hard-zero (fix fetch / refresh snapshot).
 * Exit 2 = model/slip validation failure.
 */

const path = require("path")
const {
  buildNbaBoardSlicesFromSnapshot,
  loadNbaSnapshotFromDisk,
} = require("../pipeline/nba/buildNbaBoardSlicesFromSnapshot")
const { buildNbaOpportunityBoard } = require("../pipeline/nba/buildNbaOpportunityBoard")
const { buildNbaPipelineAudit } = require("../pipeline/nba/nbaPipelineAudit")
const { ingestHardFailures, countIngestStatFamilies } = require("../pipeline/nba/nbaIngestStatFamilies")

function pk(c) {
  return String(c?.player || "")
    .trim()
    .toLowerCase()
}

function slipDuplicateIssues(slips) {
  const out = []
  for (const s of Array.isArray(slips) ? slips : []) {
    const seen = new Map()
    for (const L of s.legs || []) {
      const k = pk(L)
      if (!k) continue
      seen.set(k, (seen.get(k) || 0) + 1)
    }
    for (const [k, n] of seen.entries()) {
      if (n > 1) out.push(`duplicate_player_in_slip:${String(s.type || "?")}:${k}`)
    }
  }
  return out
}

function blockingAuditIssues(issues) {
  return (Array.isArray(issues) ? issues : []).filter(
    (i) => i !== "first_basket_count_zero" && i !== "high_per_player_density"
  )
}

function runOnePass(snapPath, snap) {
  const slices = buildNbaBoardSlicesFromSnapshot(snap)
  const rawIngest = Array.isArray(snap.rawProps) ? snap.rawProps : Array.isArray(snap.props) ? snap.props : []
  const ingestDiag =
    snap?.diagnostics && typeof snap.diagnostics === "object"
      ? {
          ingestCoverage: snap.diagnostics.ingestCoverage,
          baseMarkets: snap.diagnostics.fetchAudit?.baseRequestMarkets,
          extraMarkets: snap.diagnostics.fetchAudit?.extraRequestMarkets,
        }
      : {}

  const opp = buildNbaOpportunityBoard({
    ladderBoard: slices.ladderBoard,
    corePropsBoard: slices.corePropsBoard,
    completeUniverse: slices.completeUniverse,
    ingestDiagnostics: ingestDiag,
    ingestRows: rawIngest,
  })

  const audit =
    opp.meta?.pipelineAudit ||
    buildNbaPipelineAudit({
      label: "nbaPipelineHardAudit",
      ingestRows: rawIngest,
      ingestCoverage: snap?.diagnostics?.ingestCoverage ?? null,
      requestedBaseMarkets: snap?.diagnostics?.fetchAudit?.baseRequestMarkets ?? [],
      requestedExtraMarkets: snap?.diagnostics?.fetchAudit?.extraRequestMarkets ?? [],
      completeUniverse: slices.completeUniverse,
      ladderBoard: slices.ladderBoard,
      corePropsBoard: slices.corePropsBoard,
      opportunityBoard: opp,
      aiPicks: opp.aiPicks,
      aiSlips: opp.aiSlips,
    })

  const ingestStatFamilies = countIngestStatFamilies(rawIngest)
  const hardZero = ingestHardFailures(ingestStatFamilies)
  const blockIssues = blockingAuditIssues(audit.issues)
  const dupSlip = slipDuplicateIssues(opp.aiSlips?.slips)

  const threesIngest = ingestStatFamilies.threes > 0
  const threesLadder = (opp.threesLadderCandidates || []).length
  const ladderGap = threesIngest && threesLadder === 0 && (opp.ladderCandidates || []).length > 0

  const slipProblems = []
  for (const s of opp.aiSlips?.slips || []) {
    const t = String(s.type || "")
    if (t === "BALANCED" && (s.legs || []).length === 0) slipProblems.push("balanced_slip_empty")
    if (t === "LOTTO" && (s.legs || []).length === 0) slipProblems.push("lotto_slip_empty")
  }

  const failures = [
    ...blockIssues,
    ...(ladderGap ? ["threes_ladder_pool_empty_despite_ingest"] : []),
    ...dupSlip,
    ...slipProblems,
  ]

  return {
    snapPath,
    phase1: audit.phase1Ingest || null,
    summary: {
      ingestRows: rawIngest.length,
      ingestStatFamilies: ingestStatFamilies,
      ingestHardZeroFamilies: hardZero,
      universeRows: slices.completeUniverse?.length ?? 0,
      threesLadderCandidates: threesLadder,
      slips: (opp.aiSlips?.slips || []).map((s) => ({ type: s.type, legs: (s.legs || []).length, note: s.note || null })),
    },
    failures,
    auditIssues: audit.issues,
  }
}

const snapPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "snapshot.json"))
const inner = loadNbaSnapshotFromDisk(snapPath)
if (!inner || typeof inner !== "object") {
  console.error("No snapshot data at:", snapPath)
  process.exit(1)
}
const snap = inner

const passes = []
for (let i = 1; i <= 2; i++) {
  passes.push({ pass: i, ...runOnePass(snapPath, snap) })
}

const allFailures = passes.flatMap((p) => p.failures.map((f) => `pass${p.pass}:${f}`))

console.log(JSON.stringify({ snapPath, passes, allFailures }, null, 2))

if (passes.some((p) => (p.summary.ingestHardZeroFamilies || []).length)) {
  console.error("[HARD-AUDIT] Ingest missing required stat families — refresh snapshot / fetch (see ingestHardZeroFamilies).")
  process.exit(1)
}
if (allFailures.length) {
  console.error("[HARD-AUDIT] Blocking failures:", allFailures.join("; "))
  process.exit(2)
}
process.exit(0)
