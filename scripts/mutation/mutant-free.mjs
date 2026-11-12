// Which files of a mutation plan Stryker finds no mutant in.
//
// Stryker's report has an entry for a file only when it placed a mutant in it, so a module of re-exports or of
// types is mutated by a run and still absent from its report. A report lacking such a file can still be the complete
// evidence of a run over this checkout; a report lacking a file with mutants cannot (./adopt.mjs). The question is
// put to Stryker's own instrumenter over the text on disk, with no ignorer and no excluded mutation: a mutant a run
// only ignores is still in the report, so it counts. A file that cannot be read or parsed rejects.

import { readFileSync } from "node:fs"
import path from "node:path"
import { Instrumenter } from "@stryker-mutator/instrumenter"

/* Stryker disable all: a logger that discards every message has no behaviour of its own to test; the instrumenter only
   needs its shape. */
const nothing = () => {}
/** The instrumenter wants Stryker's logger; this run has nothing to say through it. */
const silent = {
  trace: nothing,
  debug: nothing,
  info: nothing,
  warn: nothing,
  error: nothing,
  fatal: nothing,
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
}
/* Stryker restore all */

/** No ignorer plugin and no excluded mutation: a mutant a run would only ignore is still in its report, so it counts. */
const NONE = []

/**
 * @param {string} cwd - the package.
 * @param {readonly string[]} files - sources, relative to the package, with `/` separators as a Stryker plan has them.
 * @returns {Promise<string[]>} the files, in the order given, that Stryker would place no mutant in. Rejects when a file
 *   cannot be read or parsed, since then nothing can be said about it.
 */
export async function mutantFreeFiles(cwd, files) {
  const inputs = files.map((file) => {
    const name = path.join(cwd, file)
    return { name, content: readFileSync(name, "utf8"), mutate: true }
  })
  const fileOf = new Map(inputs.map((input, index) => [input.name, files[index]]))
  const { mutants } = await new Instrumenter(silent).instrument(inputs, {
    ignorers: NONE,
    plugins: null,
    excludedMutations: NONE,
  })
  const withMutants = new Set(mutants.map((mutant) => fileOf.get(mutant.fileName)))
  return files.filter((file) => !withMutants.has(file))
}
