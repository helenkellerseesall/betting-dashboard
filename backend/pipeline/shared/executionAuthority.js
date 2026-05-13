"use strict"

/**
 * Execution Authority — runtime ownership probe.
 *
 * Records which module / route / function claims authority for a given
 * named operation during a request lifecycle, then surfaces a structured
 * diagnostics block that makes overlap visible.
 *
 * Use cases:
 *   - Detect that two routes both rebuilt the MLB snapshot in the same
 *     request flow (duplicate ownership).
 *   - Confirm at runtime which route is the canonical owner of an
 *     operation (the LATER claimant on the same operation is logged as
 *     "duplicateOwnershipDetected").
 *   - Surface the canonical owner in `diagnostics.executionAuthority` so
 *     operators can see at a glance which path produced the snapshot.
 *
 * Architectural rules honored:
 *   - Pure utility; no I/O, no module-load side effects.
 *   - Additive: callers OPT IN by creating a probe and recording.
 *   - Read-only: never modifies request/response state; only collects.
 *   - Bounded: at most 50 entries per probe.
 *   - Fail-open: any internal exception is swallowed; probe returns a
 *     minimal diagnostics object.
 *
 * Public API:
 *   createExecutionAuthorityProbe(label?) — returns a probe instance
 *     .record(operation, ownerPath, opts?)         — register an authority claim
 *     .recordCanonical(operation, ownerPath, opts?) — mark this owner as canonical
 *     .summary()                                    — get the diagnostics block
 *
 * Diagnostics shape:
 *   {
 *     label,                                  // identifier for this probe
 *     authorities: [                          // ordered list of claims
 *       { operation, ownerPath, capturedAtIso, opts }
 *     ],
 *     canonicalByOperation: { [op]: ownerPath },
 *     duplicateOwnershipDetected: [           // ops claimed > 1 owner
 *       { operation, owners: [path, path, ...] }
 *     ],
 *     orphanExecutionPathHints: [],           // populated externally
 *     count,
 *   }
 *
 * Tag emitted on duplicate detection:
 *   `[EXECUTION-AUTHORITY-DUPLICATE]` — single JSON line per operation on first dup.
 */

const MAX_ENTRIES = 50

function nowIso() {
	try { return new Date().toISOString() } catch { return null }
}

function createExecutionAuthorityProbe(label = "execution_authority") {
	const authorities = []
	const ownersByOp = new Map()
	const canonicalByOp = new Map()
	const dupsLogged = new Set()

	function record(operation, ownerPath, opts) {
		try {
			if (authorities.length >= MAX_ENTRIES) return
			const op = String(operation || "unknown")
			const path = String(ownerPath || "unknown")
			authorities.push({
				operation: op,
				ownerPath: path,
				capturedAtIso: nowIso(),
				opts: opts && typeof opts === "object" ? { ...opts } : null,
			})
			const owners = ownersByOp.get(op) || []
			owners.push(path)
			ownersByOp.set(op, owners)
			if (owners.length > 1 && !dupsLogged.has(op)) {
				dupsLogged.add(op)
				console.log("[EXECUTION-AUTHORITY-DUPLICATE]", JSON.stringify({
					probe: label,
					operation: op,
					owners,
					note: "two or more modules claimed authority for the same operation in this request — duplicate ownership detected",
				}))
			}
		} catch (_) { /* swallow */ }
	}

	function recordCanonical(operation, ownerPath, opts) {
		record(operation, ownerPath, opts)
		canonicalByOp.set(String(operation || "unknown"), String(ownerPath || "unknown"))
	}

	function summary() {
		const dups = []
		for (const [op, owners] of ownersByOp.entries()) {
			if (owners.length > 1) dups.push({ operation: op, owners: owners.slice() })
		}
		const canonical = {}
		for (const [op, owner] of canonicalByOp.entries()) canonical[op] = owner
		return {
			label,
			authorities: authorities.slice(),
			canonicalByOperation: canonical,
			duplicateOwnershipDetected: dups,
			orphanExecutionPathHints: [],
			count: authorities.length,
		}
	}

	return { record, recordCanonical, summary }
}

function emptyExecutionAuthorityDiagnostics() {
	return {
		label: null,
		authorities: [],
		canonicalByOperation: {},
		duplicateOwnershipDetected: [],
		orphanExecutionPathHints: [],
		count: 0,
	}
}

module.exports = {
	createExecutionAuthorityProbe,
	emptyExecutionAuthorityDiagnostics,
}
