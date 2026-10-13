// The package as a clean checkout has it: only what git tracks, with this installation's dependencies, type-checked.
// Every other check reads the working tree, so a file that is ignored, or was never added, is there for all of them
// and missing for CI and for every consumer. This is the one check that reads only the index.

import { sync as spawnSync } from "cross-spawn"
import { spawnSync as gitSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/** The package scripts that type-check it, in the order they are looked for. */
export const SCRIPTS = ["typecheck", "check"]

/** How much of a failing type check's output is kept. */
export const OUTPUT_TAIL = 3000

/**
 * @param {string} cwd - the package.
 * @returns {string[] | undefined} what git tracks, or undefined when this is not a repository.
 */
function trackedFiles(cwd) {
  const listed = gitSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8", maxBuffer: 1 << 28 })
  return listed.status === 0 ? listed.stdout.split("\0").filter((name) => name !== "") : undefined
}

/**
 * @param {string} cwd - the package.
 * @param {{
 *   tracked?: (cwd: string) => string[] | undefined,
 *   typecheck?: (work: string, script: string) => { status: number | null, output: string },
 * }} [seams] - replaceable for a test.
 * @returns {{ state: "passed" | "failed" | "skipped", output: string, reason?: string }} how the tracked files type-check on
 *   their own, or why that was not tried.
 */
export function checkCleanCheckout(cwd, seams = {}) {
  const files = (seams.tracked ?? trackedFiles)(cwd)
  if (files === undefined)
    return { state: "skipped", output: "", reason: "this is not a git repository" }
  /** @type {{ scripts?: Record<string, string> }} */
  const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
  const script = SCRIPTS.find((name) => manifest.scripts?.[name] !== undefined)
  if (script === undefined) {
    return {
      state: "skipped",
      output: "",
      reason: 'package.json has no "typecheck" or "check" script',
    }
  }
  const work = mkdtempSync(path.join(tmpdir(), "clean-checkout-"))
  try {
    for (const file of files) {
      const from = path.join(cwd, file)
      if (!existsSync(from)) continue
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true })
      copyFileSync(from, path.join(work, file))
    }
    if (existsSync(path.join(cwd, "node_modules"))) {
      // Stryker disable next-line StringLiteral: equivalent -- the kind of link only matters on Windows, which reads a folder link without administrator rights only as a junction.
      symlinkSync(path.join(cwd, "node_modules"), path.join(work, "node_modules"), "junction")
    }
    const ran = (seams.typecheck ?? typecheck)(work, script)
    return ran.status === 0
      ? { state: "passed", output: "" }
      : { state: "failed", output: ran.output.slice(-OUTPUT_TAIL) }
  } finally {
    // Stryker disable next-line BooleanLiteral: equivalent -- the copy always exists when it is removed.
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * @param {string} work - the copy.
 * @param {string} script - the package script that type-checks it.
 * @returns {{ status: number | null, output: string }} the package's own type check, run there.
 */
function typecheck(work, script) {
  // Stryker disable next-line StringLiteral: equivalent -- npm prints its banner only to a terminal, never to this pipe.
  const ran = spawnSync("npm", ["run", script, "--silent"], {
    cwd: work,
    // Stryker disable next-line StringLiteral: equivalent -- a Buffer prints as the same text below.
    encoding: "utf8",
  })
  return { status: ran.status, output: `${ran.stdout}${ran.stderr}` }
}
