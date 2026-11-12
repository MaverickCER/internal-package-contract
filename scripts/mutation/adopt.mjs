// Judging a mutation report made elsewhere, such as the merged slices of a sharded run (./shard.mjs, ./merge.mjs).
// `IPC_MUTATION_REPORT=<file>` names it; the run copies it where Stryker would have written its own, and the
// `Mutation` check judges it by the same rules, without mutating again.
//
// A report is adopted only when it is evidence about this checkout: every file a full run would mutate is in it,
// or Stryker's instrumenter finds no mutant in that file's text on disk (./mutant-free.mjs), no file is in it that
// this run would not mutate, and each file's recorded source is the text on disk. Anything else refuses the report,
// and the check fails: slices made from another revision or another plan would otherwise judge different code. The
// evidence a previous run left is removed first, so a refused report is never judged as if it had been accepted.

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
