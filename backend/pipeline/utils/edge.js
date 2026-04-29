"use strict"

function impliedProbability(odds) {
  if (odds > 0) return 100 / (odds + 100)
  return Math.abs(odds) / (Math.abs(odds) + 100)
}

function computeEdge(probability, odds) {
  if (!odds) return 0
  const implied = impliedProbability(odds)
  return probability - implied
}

module.exports = { impliedProbability, computeEdge }
