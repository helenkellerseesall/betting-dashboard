#!/usr/bin/env node
"use strict"

/**
 * Offline NBA pipeline audit: snapshot → slices → opportunity board → AI → slips.
 * Usage: node backend/scripts/nbaPipelineSelfCheck.js [path/to/snapshot.json]
 * Env: NBA_PIPELINE_AUDIT=1 prints full audit JSON to stderr.
 */

const path = require("path")
const {
  buildNbaBoardSlicesFromSnapshot,
  loadNbaSnapshotFromDisk,
} = require("../pipeline/nba/buildNbaBoardSlicesFromSnapshot")
const { buildNbaOpportunityBoard } = require("../pipeline/nba/buildNbaOpportunityBoard")
const { buildNbaPipelineAudit } = require("../pipeline/nba/nbaPipelineAudit")

const snapPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "snapshot.json"))
const inner = loadNbaSnapshotFromDisk(snapPath)
if (!inner || typeof inner !== "object") {
  console.error("No snapshot data at:", snapPath)
  process.exit(1)
}

const snap = inner
const slices = buildNbaBoardSlicesFromSnapshot(snap)
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
  ingestRows: Array.isArray(snap.rawProps) ? snap.rawProps : Array.isArray(snap.props) ? snap.props : [],
})

const audit =
  opp.meta?.pipelineAudit ||
  buildNbaPipelineAudit({
    label: "nbaPipelineSelfCheck",
    completeUniverse: slices.completeUniverse,
    ladderBoard: slices.ladderBoard,
    corePropsBoard: slices.corePropsBoard,
    opportunityBoard: opp,
    aiPicks: opp.aiPicks,
    aiSlips: opp.aiSlips,
    ingestDiagnostics: ingestDiag,
  })

const summary = {
  snapshotPath: snapPath,
  phase1Ingest: audit.phase1Ingest || null,
  issues: audit.issues,
  threes: audit.threesSignal,
  firstBasket: audit.firstBasketSignal,
  opportunity: audit.opportunity,
  aiPicks: {
    eliteCount: (opp.aiPicks?.elite || []).length,
    strongCount: (opp.aiPicks?.strong || []).length,
  },
      slips: (opp.aiSlips?.slips || []).map((s) => ({ type: s.type, legs: (s.legs || []).length })),
      outcomePredictions: opp.playerOutcomePredictions
        ? { players: (opp.playerOutcomePredictions.players || []).length }
        : null,
}

console.log(JSON.stringify(summary, null, 2))
if (String(process.env.NBA_PIPELINE_STRICT || "") === "1" && Array.isArray(audit.issues) && audit.issues.length) {
  process.exit(2)
}
