// `internal-package-contract generate [--check]`: rewrites the generated regions in a package's documents.
//
//   internal-package-contract generate           rewrite every generated region that is stale
//   internal-package-contract generate --check   write nothing; fail and name what is stale
//
// Only the documents listed here are read, only text between a region's markers is replaced, and the result is
// formatted with the package's own Prettier settings, so a rerun changes nothing and `format:check` still passes.
// A region that cannot be generated (bad markers, an unknown generator, a missing or inconsistent source) is
// reported as `file:line: message` and nothing is written.

import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { format, resolveConfig } from "prettier"
import { DOCUMENTS } from "./documents.mjs"
import { dependencyRegion } from "./dependencies.mjs"
import { entryPointRows, toTable } from "./entry-points.mjs"
import { standardsRegion } from "./standards.mjs"
import { findRegions, replaceRegions } from "./regions.mjs"

export { DOCUMENTS }
const SURFACE = "docs/surface.json"
const USAGE = "Usage: internal-package-contract generate [--check]\n"

/**
 * The generator for each region name. Every one reads `package.json` and `docs/surface.json`; what only a person
 * can say lives once in the latter, and everything derivable comes from the package itself.
 * @type {Record<string, (sources: { pkg: any, surface: unknown }, exists: (file: string) => boolean) => { problems: string[], markdown: string }>}
 */
// Listed alphabetically: the order is the one an unknown-region problem names them in.
const GENERATORS = {
  dependencies: ({ pkg, surface }) => dependencyRegion(pkg, surface),
  "entry-points": ({ pkg, surface }) => {
    const { problems, rows } = entryPointRows(pkg, surface)
    // With problems nothing is written, so a table built from a half-valid source is never used.
    return { problems, markdown: toTable(rows) }
  },
  standards: ({ surface }, exists) => standardsRegion(surface, exists),
}

/**
 * @param {string} cwd - the package root.
 * @param {string[]} needs - the region names being generated, for the message when the sources are missing.
 * @returns {{ pkg: any, surface: unknown, problems: string[] }} the parsed sources, and what is wrong with them.
 */
function readSources(cwd, needs) {
  /** @type {string[]} */
  const problems = []
  let pkg
  try {
    pkg = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
  } catch {
    problems.push("package.json is missing or is not valid JSON.")
  }
  if (pkg !== undefined && (typeof pkg !== "object" || pkg === null || Array.isArray(pkg))) {
    problems.push("package.json is not a JSON object.")
    pkg = undefined
  }
  let surface
  if (!existsSync(path.join(cwd, SURFACE))) {
    const names = needs.map((name) => `"${name}"`).join(", ")
    problems.push(
      `${SURFACE} not found; it holds what only a person can say for the ${names} region${needs.length === 1 ? "" : "s"}.`,
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
  const names = [...new Set(scanned.flatMap((document) => document.regions.map((r) => r.name)))]
  const known = names.filter((name) => Object.hasOwn(GENERATORS, name)).sort()
  for (const { file, regions } of scanned) {
    for (const region of regions) {
      if (!Object.hasOwn(GENERATORS, region.name)) {
        problems.push(
          `${file}: region "${region.name}" has no generator. Available: ${Object.keys(GENERATORS).join(", ")}.`,
        )
      }
    }
  }
  /** @type {Record<string, string>} */
  const bodies = {}
  if (known.length > 0) {
    const sources = readSources(cwd, known)
    problems.push(...sources.problems)
    if (sources.pkg !== undefined && sources.surface !== undefined) {
      // A cited test must be a regular file inside this package, symlinks resolved, so a path that climbs
      // out (`../other/x.test.ts`, an absolute path, a link to elsewhere) is never presented as its test.
      const root = realpathSync(cwd)
      const exists = (file) => {
        const target = path.resolve(root, file)
        if (!existsSync(target)) return false
        const real = realpathSync(target)
        return real.startsWith(root + path.sep) && statSync(real).isFile()
      }
      for (const name of known) {
        const { problems: found, markdown } = GENERATORS[name](sources, exists)
        problems.push(...found)
        bodies[name] = markdown
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
    // Only reached with no problems, so every region here has a body.
    /** @type {Record<string, string>} */
    const formatted = {}
    for (const name of new Set(regions.map((region) => region.name))) {
      formatted[name] = (await format(bodies[name], { ...options, parser: "markdown" })).trimEnd()
    }
    const next = replaceRegions(text, regions, (name) => formatted[name])
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
