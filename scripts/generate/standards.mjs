// The "standards" region: the standard-format documents a package generates (SARIF, OSCAL, CycloneDX, PROV, ...),
// listed once in `docs/surface.json`. Each entry names the test that checks the document's format. Generation
// stops when that test file does not exist. So a claim that a document matches its schema stays something a
// reader can rerun, not a sentence that outlives its test. An empty list renders one sentence saying the
// package generates none. A missing list, a missing field or a line break in a cell stops generation.

import { toTable } from "./entry-points.mjs"

const FIELDS = ["document", "standard", "producedBy", "checkedAgainst", "test", "limits"]

/**
 * @param {unknown} surface - the parsed `docs/surface.json`.
 * @param {(file: string) => boolean} exists - whether a path, relative to the package root, is a regular file.
 * @returns {{ problems: string[], markdown: string }} the region's body, or what stops it being written.
 */
export function standardsRegion(surface, exists) {
  /** @type {string[]} */
  const problems = []
  const rows = [["Document", "Standard", "Produced by", "Checked against", "Test", "Limits"]]
  const standards = /** @type {{ standards?: unknown } | null | undefined} */ (surface)?.standards
  if (!Array.isArray(standards)) {
    problems.push(
      'docs/surface.json needs a "standards" list for the "standards" region: one entry per standard-format document the package generates.',
    )
    return { problems, markdown: toTable(rows) }
  }
  if (standards.length === 0) {
    return { problems, markdown: "This package generates no standard-format documents." }
  }
  standards.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      problems.push(`docs/surface.json standards entry ${String(index + 1)} must be an object.`)
      return
    }
    const label =
      typeof entry.document === "string" && entry.document.trim() !== ""
        ? `"${entry.document}"`
        : String(index + 1)
    const missing = FIELDS.filter(
      (field) => typeof entry[field] !== "string" || entry[field].trim() === "",
    )
    if (missing.length > 0) {
      problems.push(`docs/surface.json standards entry ${label} needs ${missing.join(", ")}.`)
      return
    }
    const multiline = FIELDS.filter((field) => /[\r\n]/.test(entry[field]))
    if (multiline.length > 0) {
      problems.push(
        `docs/surface.json standards entry ${label} has a line break in ${multiline.join(", ")}; a table cell holds one line.`,
      )
      return
    }
    if (!exists(entry.test)) {
      problems.push(
        `docs/surface.json standards entry ${label} cites test "${entry.test}", which is not a file in this package.`,
      )
      return
    }
    rows.push([
      entry.document,
      entry.standard,
      entry.producedBy,
      entry.checkedAgainst,
      `\`${entry.test}\``,
      entry.limits,
    ])
  })
  return { problems, markdown: toTable(rows) }
}
