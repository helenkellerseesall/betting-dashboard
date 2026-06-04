#!/usr/bin/env node
"use strict"

/**
 * check-html-syntax.js — companion to scripts/hooks/pre-commit (Wave 1 A4)
 *
 * `node --check` does NOT work on .html files (Node 22+ throws
 * ERR_UNKNOWN_FILE_EXTENSION). Per binding memory
 * [[feedback-html-js-syntax-check-method]], inline FE JS is validated by
 * extracting EVERY <script> block and parsing it via new Function().
 * The naive single-regex approach only grabs the FIRST <script> block — this
 * loops over ALL of them (the memory's documented caveat).
 *
 * Usage:
 *   git show ":frontend/x.html" | node check-html-syntax.js --stdin frontend/x.html
 *   node check-html-syntax.js path/to/file.html        (reads from disk)
 *
 * Exit 0 = all inline scripts parse. Exit 1 = a syntax error (or read fail).
 * Pure syntax gate — new Function() parses but does NOT execute.
 */

const fs = require("fs")

const args = process.argv.slice(2)
let html
let display

try {
  if (args[0] === "--stdin") {
    display = args[1] || "<stdin>"
    html = fs.readFileSync(0, "utf8") // fd 0 = stdin
  } else {
    display = args[0]
    if (!display) {
      console.error("check-html-syntax: no input (pass a file path or --stdin <name>)")
      process.exit(1)
    }
    html = fs.readFileSync(display, "utf8")
  }
} catch (e) {
  console.error("check-html-syntax: cannot read " + (display || "input") + ": " + e.message)
  process.exit(1)
}

const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
let m
let total = 0
let checked = 0

while ((m = re.exec(html)) !== null) {
  total++
  const attrs = m[1] || ""
  // External scripts have no inline body to parse.
  if (/\bsrc\s*=/.test(attrs)) continue
  // Data/template blocks are not JS.
  if (/type\s*=\s*["']?(application\/json|text\/template|text\/html)/i.test(attrs)) continue
  const body = m[2] || ""
  if (!body.trim()) continue
  try {
    new Function(body) // eslint-disable-line no-new-func
    checked++
  } catch (e) {
    console.error(
      "SYNTAX ERROR in <script> block #" + total + " of " + display + ": " + e.message
    )
    process.exit(1)
  }
}

console.log(
  "HTML OK: " + display + " (" + checked + " inline script block(s) parsed, " + total + " <script> tag(s) total)"
)
process.exit(0)
