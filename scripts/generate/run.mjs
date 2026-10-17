// `internal-package-contract generate [--check]`: rewrites the generated regions in a package's documents.
//
//   internal-package-contract generate           rewrite every generated region that is stale
//   internal-package-contract generate --check   write nothing; fail and name what is stale
//
// Only the documents listed here are read, only text between a region's markers is replaced, and the result is
// formatted with the package's own Prettier settings, so a rerun changes nothing and `format:check` still passes.
// A region that cannot be generated (bad markers, an unknown generator, a missing or inconsistent source) is
// reported as `file:line: message` and nothing is written.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { format, resolveConfig } from "prettier"
import { DOCUMENTS } from "./documents.mjs"
import { entryPointRows, toTable } from "./entry-points.mjs"
import { findRegions, replaceRegions } from "./regions.mjs"

export { DOCUMENTS }
const SURFACE = "docs/surface.json"
const USAGE = "Usage: internal-package-contract generate [--check]\n"

/**
 * @param {string} cwd
 * @returns {{ pkg: { name: string, exports?: Record<string, unknown> } | undefined, surface: unknown, problems: string[] }}
 */
function readSources(cwd) {
  /** @type {string[]} */
  const problems = []
  let pkg
  try {
    pkg = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
  } catch {
    problems.push("package.json is missing or is not valid JSON.")
  }
  let surface
  if (!existsSync(path.join(cwd, SURFACE))) {
    problems.push(
      `${SURFACE} not found; it describes each entry point for the "entry-points" region.`,
    )
  } else {
    try {
      surface = JSON.parse(readFileSync(path.join(cwd, SURFACE)).toString())
    } catch {
      problems.push(`${SURFACE} is not valid JSON.`)
    }
  }
  return { pkg, surface, problems }
}

/**
 * @param {readonly string[]} argv
 * @param {string} cwd - the package root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {{ formatOptions?: (file: string) => Promise<object> }} [hooks] - where the Prettier options come from;
 *   `init` passes the defaults, because the package's own configuration imports this one, which is not installed yet.
 * @returns {Promise<number>} the exit code.
 */
export async function run(argv, cwd, io, hooks = {}) {
  const check = argv.includes("--check")
  if (argv.some((arg) => arg !== "--check")) {
    io.err(`[generate] unknown argument: ${argv.find((arg) => arg !== "--check")}\n${USAGE}`)
    return 2
  }
  const documents = DOCUMENTS.filter((file) => existsSync(path.join(cwd, file))).map((file) => ({
    file,
    text: readFileSync(path.join(cwd, file)).toString(),
  }))
  const scanned = documents.map((document) => ({ ...document, ...findRegions(document.text) }))
  if (
    scanned.every((document) => document.regions.length === 0 && document.problems.length === 0)
  ) {
    io.out("[generate] no generated regions here; nothing to do.\n")
    return 0
  }

  /** @type {string[]} */
  const problems = []
  for (const { file, problems: found } of scanned) {
    for (const { line, message } of found) problems.push(`${file}:${String(line)}: ${message}`)
  }
  const sources = readSources(cwd)
  const needsEntryPoints = scanned.some((document) =>
    document.regions.some((region) => region.name === "entry-points"),
  )
  // Stryker disable next-line StringLiteral: equivalent -- the table is only read when no problem was found, and by then it has been built from the sources.
  let table = ""
  if (needsEntryPoints) {
    problems.push(...sources.problems)
    if (sources.pkg !== undefined && sources.surface !== undefined) {
      const { problems: sourceProblems, rows } = entryPointRows(sources.pkg, sources.surface)
      problems.push(...sourceProblems)
      // With problems nothing is written, so a table built from a half-valid source is never used.
      table = toTable(rows)
    }
  }
  for (const { file, regions } of scanned) {
    for (const region of regions) {
      if (region.name !== "entry-points") {
        problems.push(`${file}: region "${region.name}" has no generator. Available: entry-points.`)
      }
    }
  }
  if (problems.length > 0) {
    io.err(
      `[generate] nothing was written:\n${problems.map((problem) => `- ${problem}`).join("\n")}\n`,
    )
    return 1
  }

  const stale = []
  for (const { file, text, regions } of scanned) {
    // Stryker disable next-line ConditionalExpression: equivalent -- a document with no regions comes back unchanged from `replaceRegions`, so formatting for it only costs time.
    if (regions.length === 0) continue
    let options
    try {
      options = hooks.formatOptions
        ? await hooks.formatOptions(file)
        : await resolveConfig(path.join(cwd, file))
    } catch (error) {
      io.err(
        `[generate] could not load this package's Prettier configuration (${error instanceof Error ? error.message.split("\n")[0] : String(error)}). Run \`npm install\` first.\n`,
      )
      return 1
    }
    const body = (await format(table, { ...options, parser: "markdown" })).trimEnd()
    const next = replaceRegions(text, regions, () => body)
    // The region is rewritten as blank line, body, blank line; compare the whole document, not the region.
    if (next !== text) stale.push({ file, next })
  }
  if (check) {
    if (stale.length > 0) {
      io.err(
        `[generate] stale: ${stale.map((entry) => entry.file).join(", ")}. Run \`npx internal-package-contract generate\` and commit the result.\n`,
      )
      return 1
    }
    io.out("[generate] every generated region is current.\n")
    return 0
  }
  for (const { file, next } of stale) writeFileSync(path.join(cwd, file), next)
  io.out(
    stale.length === 0
      ? "[generate] every generated region was already current.\n"
      : `[generate] rewrote ${stale.map((entry) => entry.file).join(", ")}.\n`,
  )
  return 0
}
