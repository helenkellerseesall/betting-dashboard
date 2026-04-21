"use strict"

/**
 * NBA route bodies for /api/best-available and /refresh-snapshot (non-MLB paths).
 * Source is loaded from *.inlined.js slices moved verbatim from server.js.
 *
 * Handlers are compiled in server.js with `new Function("req","res","deps",...)`
 * so route-local bindings (e.g. `bestAvailableSportKey`, `sportKey`) are passed
 * explicitly via `deps`; module-scoped helpers and snapshots stay on `server.js`.
 */

const fs = require("fs")
const path = require("path")

let _nbaBestAvailableSource = null
function getNbaBestAvailableSource() {
  if (_nbaBestAvailableSource == null) {
    _nbaBestAvailableSource = fs.readFileSync(path.join(__dirname, "nbaBestAvailable.inlined.js"), "utf8")
  }
  return _nbaBestAvailableSource
}

let _nbaRefreshSnapshotSource = null
function getNbaRefreshSnapshotSource() {
  if (_nbaRefreshSnapshotSource == null) {
    _nbaRefreshSnapshotSource = fs.readFileSync(path.join(__dirname, "nbaRefreshSnapshot.inlined.js"), "utf8")
  }
  return _nbaRefreshSnapshotSource
}

module.exports = {
  getNbaBestAvailableSource,
  getNbaRefreshSnapshotSource,
}
