"use strict"

const fs = require("fs")
const path = require("path")

const MLB_EXTERNAL_CACHE_PATH = path.join(__dirname, "../../../mlb-external-cache.json")

async function readCacheFile() {
  try {
    const raw = await fs.promises.readFile(MLB_EXTERNAL_CACHE_PATH, "utf8")
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch (error) {
    if (error && error.code === "ENOENT") return {}
    return {}
  }
}

async function writeCacheFile(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {}
  await fs.promises.writeFile(MLB_EXTERNAL_CACHE_PATH, JSON.stringify(safePayload))
}

async function getMlbExternalCacheEntry({ cacheKey, maxAgeMs = 10 * 60 * 1000 } = {}) {
  const key = String(cacheKey || "").trim()
  if (!key) return null

  const cache = await readCacheFile()
  const entry = cache[key]
  if (!entry || typeof entry !== "object") return null

  const savedAtMs = Number(entry.savedAt || 0)
  if (!Number.isFinite(savedAtMs) || savedAtMs <= 0) return null

  const ageMs = Date.now() - savedAtMs
  if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && ageMs > maxAgeMs) return null

  return {
    data: entry.data,
    savedAt: savedAtMs,
    ageMs
  }
}

async function setMlbExternalCacheEntry({ cacheKey, data } = {}) {
  const key = String(cacheKey || "").trim()
  if (!key) return

  const cache = await readCacheFile()
  cache[key] = {
    savedAt: Date.now(),
    data: data && typeof data === "object" ? data : {}
  }

  await writeCacheFile(cache)
}

module.exports = {
  getMlbExternalCacheEntry,
  setMlbExternalCacheEntry,
  MLB_EXTERNAL_CACHE_PATH
}
