// What a consumer's contract run needs on disk before any check looks at it.
//
// The docs link to the benchmark history page (`docs/benchmarks/`). That page is generated from the committed
// history and never committed, so a link check run on a clean checkout finds nothing there and reports the
// link as broken. A package that defines a `docs:benchmarks` script has said how its page is built; the run
// builds it first, so the contract behaves the same on a laptop, in CI and in a fresh clone, with no
// per-package wrapper script and no copy of the command in a workflow.

import { sync as spawnSync } from "cross-spawn"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/** The package script that renders the benchmark history page. */
export const BENCHMARK_PAGE_SCRIPT = "docs:benchmarks"

/**
 * @param {string} cwd - the repository root.
 * @returns {boolean} whether its `package.json` defines the benchmark page script.
 */
export function definesBenchmarkPage(cwd) {
  const file = path.join(cwd, "package.json")
  if (!existsSync(file)) return false
  const scripts = JSON.parse(readFileSync(file).toString()).scripts
  return typeof scripts?.[BENCHMARK_PAGE_SCRIPT] === "string"
}

/**
 * @param {string} cwd - where the command runs.
 * @returns {{ cwd: string, stdio: "inherit" }} how it runs: in that folder, printing straight to the person running the contract.
 */
export function spawnOptions(cwd) {
  return { cwd, stdio: "inherit" }
}

/**
 * Builds what the checks expect to find, when the package says how.
 * @param {object} input
 * @param {string} input.cwd - the repository root.
 * @param {{ write: (text: string) => unknown }} input.out
 * @param {(command: string, args: string[], cwd: string) => number | null} [input.spawn] - how a command ends (its exit code, or `null` when it did not run to the end); a test seam.
 * @throws {Error} when the benchmark page cannot be built.
 */
export function prepare({
  cwd,
  out,
  spawn = (command, args, where) => spawnSync(command, args, spawnOptions(where)).status,
}) {
  if (!definesBenchmarkPage(cwd)) return
  out.write(`[contract] npm run ${BENCHMARK_PAGE_SCRIPT} (the benchmark page the docs link to)\n`)
  if (spawn("npm", ["run", "--silent", BENCHMARK_PAGE_SCRIPT], cwd) !== 0) {
    throw new Error(
      `\`npm run ${BENCHMARK_PAGE_SCRIPT}\` failed, so the benchmark page the docs link to does not exist. Fix it, or remove the script if this package has no benchmark history.`,
    )
  }
}
