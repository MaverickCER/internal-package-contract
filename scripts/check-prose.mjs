// Entry point for the `Prose` check (see checks/prose.ts). Reads every tracked file `isProseFile` accepts
// and prints one JSON envelope: `{ ok: true, findings, files }` or `{ ok: false, error }`. The policy
// decides the verdict.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isGenerated, isProseFile, proseDashLines } from "./prose.mjs"

/**
 * @param {string} cwd - the package root, inside a git working tree.
 * @returns {{ ok: true, files: number, findings: { file: string, line: number }[] } | { ok: false, error: string }}
 */
export function scanProse(cwd) {
  let listed
  try {
    listed = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
  } catch (error) {
    return {
      ok: false,
      error: `git ls-files failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const files = listed.split("\0").filter((file) => file !== "" && isProseFile(file))
  const findings = []
  for (const file of files) {
    let text
    try {
      text = readFileSync(path.join(cwd, file), "utf8")
    } catch {
      continue
    }
    if (isGenerated(text)) continue
    for (const line of proseDashLines(file, text)) findings.push({ file, line })
  }
  return { ok: true, files: files.length, findings }
}

// Stryker disable all: process entry point, exercised only by spawning the script
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(scanProse(process.cwd())))
}
// Stryker restore all
