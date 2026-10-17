// `internal-package-contract mutation`: mutation testing of what a change touched, as a fast loop while writing.
//
// It runs every mutant of the files that changed, and of the source files the changed tests import, and nothing
// else: always every mutant of those files (`--force`, so no earlier result stands in for a run), under the package's
// own concurrency, which it never overrides. It is advice, not the gate. A mutant in a file nobody touched can be
// killed by a test that did, and this loop does not look there, so only a full run (the `Mutation` check) can say a
// change is finished; this says what to fix before paying for one.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { changedFiles } from "../report/collect.mjs"

/** Files Stryker has nothing to mutate in. */
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/
/** What a test is called. */
const TEST = /(?:^|\/)test\/|\.(?:test|spec)\.[^./]+$/
/** A relative import: `from "./x.js"`, `import "./x.js"`, `import("./x.js")`. */
const IMPORT = /\b(?:from|import\s*\(?)\s*["'](\.{1,2}\/[^"']+)["']/g

/**
 * @param {string} cwd - the package.
 * @param {string} test - a test file, relative to the package.
 * @returns {string[]} the source files it imports by a relative path, relative to the package.
 */
export function importsOf(cwd, test) {
  const text = readFileSync(path.join(cwd, test)).toString()
  return [...text.matchAll(IMPORT)].flatMap(([, specifier]) => {
    const target = path.posix.join(path.posix.dirname(test), String(specifier))
    // TypeScript sources are imported by the name of the file they compile to.
    const candidates = [
      target,
      target.replace(/\.js$/, ".ts"),
      target.replace(/\.js$/, ".tsx"),
      target.replace(/\.mjs$/, ".mts"),
    ]
    const found = candidates.find(
      (candidate) => existsSync(path.join(cwd, candidate)) && SOURCE.test(candidate),
    )
    return found === undefined || TEST.test(found) ? [] : [found]
  })
}

/**
 * @param {string} cwd - the package.
 * @param {string} base - what the change is measured against.
 * @returns {string[]} the source files to mutate: those the change touched, and those a touched test imports.
 */
export function targetsOf(cwd, base) {
  const touched = changedFiles(cwd, base).filter(
    ({ path: file, status }) => status !== "D" && SOURCE.test(file),
  )
  const sources = touched.filter(({ path: file }) => !TEST.test(file)).map(({ path: file }) => file)
  const imported = touched
    .filter(({ path: file }) => TEST.test(file))
    .flatMap(({ path: file }) => importsOf(cwd, file))
  return [...new Set([...sources, ...imported])].sort()
}

/** The statuses that mean a mutant was not caught. */
const UNCAUGHT = ["Survived", "NoCoverage", "Timeout"]

const USAGE = "Usage: internal-package-contract mutation [--base <ref>] [file...]\n"

/**
 * @param {string[]} argv - the arguments after the command.
 * @param {string} cwd - the package.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {{
 *   spawn: (args: string[], cwd: string) => number | null,
 *   mutatePatterns: (cwd: string) => Promise<string[]>,
 *   baseOf: (cwd: string) => string | undefined,
 * }} seams - how to run Stryker, how to read the package's own `mutate` patterns, and what a change is measured against.
 * @returns {Promise<number>} the exit code: 1 when a mutant was not caught, or Stryker did not finish.
 */
export async function run(argv, cwd, io, seams) {
  /** @type {string | undefined} */
  let base
  /** @type {string[]} */
  const files = []
  let reading = false
  for (const arg of argv) {
    if (reading) {
      base = arg
      reading = false
    } else if (arg === "--base") reading = true
    else if (arg.startsWith("--")) {
      io.err(`mutation: unknown option ${arg}.\n${USAGE}`)
      return 1
    } else files.push(arg)
  }
  if (reading) {
    io.err(`mutation: --base needs a value.\n${USAGE}`)
    return 1
  }
  const against = base ?? seams.baseOf(cwd)
  if (files.length === 0 && against === undefined) {
    io.err(
      "mutation: nothing to measure a change against (no origin/main or main); name files, or give --base <ref>.\n",
    )
    return 1
  }
  const targets = files.length > 0 ? files : targetsOf(cwd, String(against))
  if (targets.length === 0) {
    io.out("Nothing to mutate: no source file changed, and no changed test imports one.\n")
    return 0
  }
  const excluded = (await seams.mutatePatterns(cwd)).filter((pattern) => pattern.startsWith("!"))
  // Stryker takes the patterns as one comma-separated value.
  const status = seams.spawn(["--mutate", [...targets, ...excluded].join(",")], cwd)
  const report = path.join(cwd, "reports", "mutation", "mutation.json")
  /** @type {Record<string, number>} */
  const counts = {}
  if (status === 0 && existsSync(report)) {
    for (const file of Object.values(JSON.parse(readFileSync(report).toString()).files)) {
      for (const mutant of /** @type {{ mutants: { status: string }[] }} */ (file).mutants) {
        counts[mutant.status] = (counts[mutant.status] ?? 0) + 1
      }
    }
  }
  const missed = UNCAUGHT.reduce((sum, name) => sum + (counts[name] ?? 0), 0)
  io.out(
    `\nMutation of ${String(targets.length)} file(s) (${targets.join(", ")}): ${String(counts.Killed ?? 0)} killed, ${String(missed)} not caught.\n` +
      "This is advice, not the gate: a full `Mutation` run, which tries every mutant in every file, is what says a change is finished.\n",
  )
  return status === 0 && missed === 0 ? 0 : 1
}
