#!/usr/bin/env node
"use strict"

/**
 * supervisorStart.js — Phase Runtime-Supervisor-B8 (2026-05-20).
 *
 * Operator-explicit boot of the supervisor daemon. No automatic
 * supervision — operator must run this. The daemon then runs in the
 * foreground (or with `&` to background) until SIGINT/SIGTERM.
 *
 * Usage:
 *   node backend/scripts/ops/supervisorStart.js
 *   SUPERVISOR_HEARTBEAT_MS=2000 node backend/scripts/ops/supervisorStart.js
 */
require("../../runtime/supervisor/daemon").start()
