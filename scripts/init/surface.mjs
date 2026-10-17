// A first draft of `docs/surface.json` for a package that has none: one entry per published entry point, with
// the source folder guessed from where the code is and everything a person must say left as a `TODO:` that the
// `PromptBlocks` check reports until it is answered.

import { publishedEntries } from "../generate/entry-points.mjs"

const TODO_ENVIRONMENT = "TODO: say where this entry point can run."
const TODO_PURPOSE = "TODO: say what a reader gets from this entry point."

/**
 * @param {string} key - an `exports` key.
 * @param {(relative: string) => boolean} exists - whether a path exists under the package root.
 * @returns {string} the guessed source: a folder with an index file, a file, or `src/` when nothing matches.
 */
export function guessSource(key, exists) {
  // For the root key "." there is nothing after the first two characters, and the root is `src/`.
  const sub = key.slice(2)
  if (sub === "") return "src/"
  if (exists(`src/${sub}`)) return `src/${sub}/`
  if (exists(`src/${sub}.ts`)) return `src/${sub}.ts`
  return "src/"
}

/**
 * @param {{ version?: string, exports?: Record<string, unknown> }} pkg
 * @param {(relative: string) => boolean} exists
 * @returns {{ entries: Record<string, { source: string, environment: string, tier: string, purpose: string }> }}
 */
export function draftSurface(pkg, exists) {
  // A package that has been released at all has users, so its entry points start as the commitment, not the trial.
  const tier = pkg.version === undefined || pkg.version === "0.0.0" ? "Experimental" : "Stable"
  return {
    entries: Object.fromEntries(
      publishedEntries(pkg.exports ?? {}).map((key) => [
        key,
        {
          source: guessSource(key, exists),
          environment: TODO_ENVIRONMENT,
          tier,
          purpose: TODO_PURPOSE,
        },
      ]),
    ),
  }
}

/** The line under a table's header: pipes around dashes, colons and spaces. */
const SEPARATOR = /^\s*\|[\s:|-]+\|\s*$/

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())

/**
 * The first table in a document whose header has an `Export` column, which is how a package that already keeps
 * a hand-written API map spells it.
 * @param {string} text - a Markdown document.
 * @returns {{ start: number, end: number, headers: string[], rows: string[][] } | undefined}
 *   `start` and `end` are line indexes, `end` exclusive; `rows` are the body rows, without the separator.
 */
export function findApiTable(text) {
  const lines = text.split("\n")
  for (const [index, line] of lines.entries()) {
    if (!line.trimStart().startsWith("|") || !SEPARATOR.test(lines[index + 1])) continue
    const headers = cells(line).map((header) => header.toLowerCase())
    if (!headers.includes("export")) continue
    let end = index + 2
    while (end < lines.length && lines[end].trimStart().startsWith("|")) end += 1
    return { start: index, end, headers, rows: lines.slice(index + 2, end).map(cells) }
  }
  return undefined
}

/** @param {string} cell @returns {string} the cell without the backticks around a code span. */
const unquote = (cell) => cell.replace(/^`+|`+$/g, "")

/**
 * Copies what a hand-written API map already says into a drafted surface, so adopting a package that has one
 * loses none of it. A row is matched to an entry point by its export specifier; a blank cell leaves the draft's
 * `TODO:` in place.
 * @param {{ entries: Record<string, Record<string, string>> }} surface - the draft, changed in place.
 * @param {{ headers: string[], rows: string[][] }} table - see {@link findApiTable}.
 * @param {string} packageName
 * @returns {number} how many entry points were filled in from the table.
 */
export function seedFromTable(surface, table, packageName) {
  const column = (names) => table.headers.findIndex((header) => names.includes(header))
  const columns = {
    export: column(["export"]),
    source: column(["source"]),
    environment: column(["environment", "runtime"]),
    tier: column(["tier", "stability"]),
    purpose: column(["purpose", "what it is for", "description"]),
  }
  let seeded = 0
  for (const row of table.rows) {
    const cell = row[columns.export]
    if (cell === undefined) continue
    const specifier = unquote(cell)
    const key =
      specifier === packageName
        ? "."
        : specifier.startsWith(`${packageName}/`)
          ? `.${specifier.slice(packageName.length)}`
          : undefined
    // Stryker disable next-line ConditionalExpression: equivalent -- an undefined key finds no entry either way.
    const entry = key === undefined ? undefined : surface.entries[key]
    if (entry === undefined) continue
    for (const field of ["source", "environment", "tier", "purpose"]) {
      // A column the table lacks has index -1, which no row has.
      const value = row[columns[field]] ?? ""
      if (value !== "") entry[field] = field === "source" ? unquote(value) : value
    }
    seeded += 1
  }
  return seeded
}
