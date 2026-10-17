// Drift check for the committed Markdown API report (`docs/api-report/`, the `typedoc --options
// typedoc.markdown.json` output). Regenerates the report into a temp directory and compares the WHOLE tree,
// so an added, removed or changed file all count as drift: a change to the public API surface cannot land
// without the report (and the diff a reviewer reads) being updated too.

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * @param {string} dir
 * @returns {string[]} every file under it, as paths relative to it, sorted.
 */
export function listFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(path.relative(dir, full))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}

/**
 * @param {string} committed - the committed report's directory.
 * @param {string} fresh - a freshly generated one.
 * @returns {{ committed: string[], added: string[], removed: string[], changed: string[] }}
 */
export function compareReports(committed, fresh) {
  const had = listFiles(committed)
  const now = listFiles(fresh)
  return {
    committed: had,
    added: now.filter((f) => !had.includes(f)),
    removed: had.filter((f) => !now.includes(f)),
    changed: now
      .filter((f) => had.includes(f))
      .filter(
        (f) => !readFileSync(path.join(fresh, f)).equals(readFileSync(path.join(committed, f))),
      ),
  }
}

/**
 * @param {string} root - the package's root.
 * @param {string} into - where to write the report.
 * @param {typeof execFileSync} [exec]
 */
export function generateReport(root, into, exec = execFileSync) {
  exec("npx", ["typedoc", "--options", "typedoc.markdown.json", "--out", into], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  })
}

/**
 * @param {readonly string[]} _argv
 * @param {string} cwd - the package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {{ generate?: (cwd: string, into: string) => void }} [hooks] - how the report is regenerated.
 * @returns {number} the exit code.
 */
export function run(_argv, cwd, io, hooks = {}) {
  const generate = hooks.generate ?? generateReport
  const fresh = mkdtempSync(path.join(tmpdir(), "api-report-"))
  try {
    generate(cwd, fresh)
    const { committed, added, removed, changed } = compareReports(
      path.join(cwd, "docs/api-report"),
      fresh,
    )
    const fail = (message, detail = "") => {
      io.err(`\nAPI report drift: ${message}\n`)
      io.err("Run `npm run docs:api:report` and commit docs/api-report/.\n")
      io.err(detail)
      return 1
    }
    if (committed.length === 0) return fail("docs/api-report/ is not committed yet")
    const detail = [
      ["new:    ", added],
      ["removed:", removed],
      ["changed:", changed],
    ]
      .filter(([, files]) => files.length > 0)
      .map(([label, files]) => `  ${label} ${files.join(", ")}\n`)
    if (detail.length > 0) return fail("the committed report is out of date", detail.join(""))
    io.out(`API report is current (${String(committed.length)} file(s)).\n`)
    return 0
  } finally {
    rmSync(fresh, { recursive: true, force: true })
  }
}
