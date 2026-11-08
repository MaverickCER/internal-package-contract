// Judging a mutation report that was made elsewhere: the slices of a sharded run (see ./shard.mjs), merged by
// ./merge.mjs. `IPC_MUTATION_REPORT=<file>` names the merged report; the run puts it where Stryker would have written
// its own and the `Mutation` check judges it by the same rule, stale exceptions included, without mutating again.
//
// A report is adopted only if it is evidence about THIS checkout: it covers the files a full run would mutate, and each
// file in it is the text that is on disk. Stryker writes no entry for a file it places no mutant in (a module of
// re-exports, a module of types), so a file the plan has and the report lacks is accepted exactly when Stryker's
// instrumenter finds no mutant in the text on disk (see ./mutant-free.mjs); a lacking file with mutants would go
// unjudged, and refuses the report. Slices made from another revision or another plan cannot be combined into a report
// that looks complete but judged different code. Whatever is wrong, the evidence a previous run left is removed first,
// so a failed adoption can never be judged as if it had succeeded.

import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { mutantFreeFiles } from "./mutant-free.mjs"
import { reportShapeError } from "./report-shape.mjs"

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
 * @param {string} text - a file's text.
 * @returns {string} the text with its line endings made `\n`, so a checkout's line-ending setting does not matter.
 */
const normalised = (text) => text.replace(/\r\n/g, "\n")

/**
 * @param {string} cwd - the package.
 * @param {string} source - the report to adopt.
 * @param {readonly string[]} files - the files a full run of this checkout mutates, relative to the package.
 * @param {(files: readonly string[]) => Promise<string[]>} [mutantFree] - which of some files Stryker would place no
 *   mutant in; by default Stryker's instrumenter is asked (see ./mutant-free.mjs).
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>} whether it is now the evidence, or why it cannot be.
 */
export async function adoptReport(
  cwd,
  source,
  files,
  mutantFree = (absent) => mutantFreeFiles(cwd, absent),
) {
  const target = path.join(cwd, EVIDENCE)
  rmSync(target, { force: true })
  let report
  try {
    report = JSON.parse(readFileSync(source))
  } catch (error) {
    return { ok: false, error: `${source} cannot be read as a mutation report (${error.message}).` }
  }
  const shape = reportShapeError(report)
  if (shape !== undefined) {
    return { ok: false, error: `${source} is not a mutation report: ${shape}` }
  }
  const reported = Object.keys(report.files).sort()
  const expected = [...files].sort()
  const absent = expected.filter((file) => !(file in report.files))
  let missing = absent
  if (absent.length > 0) {
    try {
      const free = new Set(await mutantFree(absent))
      missing = absent.filter((file) => !free.has(file))
    } catch (error) {
      return {
        ok: false,
        error: `${source} lacks ${absent.join(", ")}, and whether Stryker would mutate them could not be told: ${error.message}`,
      }
    }
  }
  const extra = reported.filter((file) => !expected.includes(file))
  if (missing.length > 0 || extra.length > 0) {
    const parts = [
      ...(missing.length > 0 ? [`it lacks ${missing.join(", ")}`] : []),
      ...(extra.length > 0 ? [`it has ${extra.join(", ")}, which this run does not mutate`] : []),
    ]
    return {
      ok: false,
      error: `${source} was not made from this checkout's plan: ${parts.join("; ")}.`,
    }
  }
  const changed = reported.filter((file) => {
    try {
      return (
        normalised(readFileSync(path.join(cwd, file), "utf8")) !==
        normalised(report.files[file].source)
      )
    } catch {
      return true
    }
  })
  if (changed.length > 0) {
    return {
      ok: false,
      error: `${source} was not made from this checkout: ${changed.join(", ")} differ from the text that was mutated.`,
    }
  }
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(source, target)
  return { ok: true }
}
