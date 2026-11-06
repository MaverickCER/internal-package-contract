// Judging a mutation report that was made elsewhere: the slices of a sharded run (see ./shard.mjs), merged by
// ./merge.mjs. `IPC_MUTATION_REPORT=<file>` names the merged report; the run puts it where Stryker would have written
// its own and the `Mutation` check judges it by the same rule, stale exceptions included, without mutating again.

import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

/** Where the `Mutation` check reads its evidence, relative to the package. */
const EVIDENCE = path.join("reports", "mutation", "mutation.json")

/**
 * @param {Record<string, string | undefined>} env - the environment of the run.
 * @param {string} cwd - the package.
 * @returns {string | undefined} the report to judge, or `undefined` when the run should mutate.
 */
export function reportToAdopt(env, cwd) {
  const named = env.IPC_MUTATION_REPORT?.trim() ?? ""
  return named === "" ? undefined : path.resolve(cwd, named)
}

/**
 * @param {string} cwd - the package.
 * @param {string} source - the report to adopt.
 * @returns {{ ok: true } | { ok: false, error: string }} whether it is now the evidence, or why it cannot be.
 */
export function adoptReport(cwd, source) {
  let report
  try {
    report = JSON.parse(readFileSync(source))
  } catch (error) {
    return { ok: false, error: `${source} cannot be read as a mutation report (${error.message}).` }
  }
  const files = report?.files
  if (
    typeof files !== "object" ||
    files === null ||
    Array.isArray(files) ||
    Object.keys(files).length === 0
  ) {
    return { ok: false, error: `${source} is not a mutation report with any file in it.` }
  }
  const target = path.join(cwd, EVIDENCE)
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(source, target)
  return { ok: true }
}
