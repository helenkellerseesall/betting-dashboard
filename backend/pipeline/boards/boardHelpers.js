function normalizeLower(value) {
  return String(value || "").trim().toLowerCase()
}

function normalizeFeaturedPlayerKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function buildPlayerPropTypeKey(row) {
  return [
    normalizeLower(row?.player),
    normalizeLower(row?.propType)
  ].join("|")
}

function buildRowLegKey(row) {
  return [
    normalizeLower(row?.player),
    normalizeLower(row?.propType),
    normalizeLower(row?.side),
    String(row?.line ?? ""),
    normalizeLower(row?.marketKey),
    normalizeLower(row?.propVariant || "base")
  ].join("|")
}

module.exports = {
  normalizeLower,
  normalizeFeaturedPlayerKey,
  buildPlayerPropTypeKey,
  buildRowLegKey
}
