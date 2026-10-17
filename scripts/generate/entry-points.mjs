// The "public API map": one row per entry point a package publishes, from `exports` in `package.json` and
// what only a person can say about each (`docs/surface.json`). The export name, the entry point's existence and
// the number of rows are derived, so a table can no longer omit an entry point or list one that is gone; the
// source folder, runtime constraint, stability tier and purpose are the person's, kept in one place instead of
// in every document that lists the entry points.

const TIERS = ["Stable", "Experimental", "Internal"]
const FIELDS = ["source", "environment", "tier", "purpose"]

/**
 * @param {Record<string, unknown>} exportsMap - a package's `exports`.
 * @returns {string[]} the entry points a reader can import: no `./package.json`, no wildcard patterns.
 */
export function publishedEntries(exportsMap) {
  return Object.keys(exportsMap).filter((key) => key !== "./package.json" && !key.includes("*"))
}

/**
 * @param {string} name - the package name.
 * @param {string} key - an `exports` key.
 * @returns {string} what a reader writes to import it.
 */
export function specifier(name, key) {
  // For the root key "." the slice is empty, so the same expression covers both.
  return `${name}${key.slice(1)}`
}

/**
 * @param {{ name: string, exports?: Record<string, unknown> }} pkg
 * @param {unknown} surface - the parsed `docs/surface.json`.
 * @returns {{ problems: string[], rows: string[][] }} the table's header row first, then one row per entry point.
 */
export function entryPointRows(pkg, surface) {
  /** @type {string[]} */
  const problems = []
  const entries = surface?.entries
  if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
    return { problems: ['docs/surface.json needs an "entries" object.'], rows: [] }
  }
  const published = publishedEntries(pkg.exports ?? {})
  const isPublished = new Set(published)
  for (const key of published) {
    if (!(key in entries))
      problems.push(`docs/surface.json has no entry for "${key}", which package.json exports.`)
  }
  for (const key of Object.keys(entries)) {
    if (!isPublished.has(key)) {
      problems.push(`docs/surface.json lists "${key}", which package.json does not export.`)
    }
  }
  const rows = [["Export", "Source", "Environment", "Tier", "Purpose"]]
  for (const key of published.filter((entry) => entry in entries)) {
    const entry = entries[key]
    const missing = FIELDS.filter(
      (field) => typeof entry[field] !== "string" || entry[field].trim() === "",
    )
    if (missing.length > 0) {
      problems.push(`docs/surface.json entry "${key}" needs ${missing.join(", ")}.`)
      continue
    }
    if (!TIERS.includes(entry.tier)) {
      problems.push(
        `docs/surface.json entry "${key}" has tier "${entry.tier}"; use ${TIERS.join(", ")}.`,
      )
      continue
    }
    rows.push([
      `\`${specifier(pkg.name, key)}\``,
      `\`${entry.source}\``,
      entry.environment,
      entry.tier,
      entry.purpose,
    ])
  }
  return { problems, rows }
}

/**
 * @param {string[][]} rows - header first.
 * @returns {string} a Markdown table, unpadded; the caller formats it with the package's Prettier settings.
 */
export function toTable(rows) {
  const cells = (row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`
  return [
    cells(rows[0]),
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map(cells),
  ].join("\n")
}
