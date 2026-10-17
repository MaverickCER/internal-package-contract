// A change report as Markdown a person can paste into a pull request: what changed in the package, what it does to a
// release, and what the checks said, in the order a reviewer asks. Every line comes from a fact (see collect.mjs);
// a section with nothing in it is left out rather than saying so, so a small change reads as a small report.

import { AREAS, areaOf } from "./collect.mjs"

/** The checks whose answer a reviewer wants even when they pass, in the order they are shown. */
export const EVIDENCE = [
  "Tests",
  "Coverage",
  "Mutation",
  "Crap",
  "Duplication",
  "ApiContract",
  "SurfaceContract",
  "BenchmarkCoverage",
  "BenchmarkComplexity",
  "Size",
]

/** What no local run can say: each is decided by a service or by CI, and is named so nobody assumes it was seen. */
export const CI_ONLY = [
  "CodeRabbit's review of the pull request, and whether its threads are resolved",
  "code scanning and branch protection as GitHub has them configured",
  "the benchmark job, which commits the figures that are published",
  "the CI jobs the contract does not run: other TypeScript versions, other runtimes, the examples and the integration fixtures",
]

const LONGEST = 220

/** @param {string} text @returns {string} the first line of it, shortened. */
const firstLine = (text) => {
  const line = text.replace(/\n[\s\S]*/, "").trim()
  return line.length > LONGEST ? `${line.slice(0, LONGEST - 1)}…` : line
}

/** @param {string} text @returns {string} the text with the table's separator escaped, for a cell. */
const cell = (text) => text.replaceAll("|", "\\|")

/** @param {string} text @returns {string} the first sentence of it, for a reason that may run to paragraphs. */
const firstSentence = (text) =>
  firstLine(String(text.replace(/\s+/g, " ").split(/(?<=[.!?])\s/, 1)))

/** @param {string[]} header @param {string[][]} rows @returns {string[]} a Markdown table. */
const table = (header, rows) => [
  `| ${header.join(" | ")} |`,
  `|${header.map(() => "---").join("|")}|`,
  ...rows.map((row) => `| ${row.join(" | ")} |`),
]

/**
 * @param {import("./collect.mjs").ChangeFacts} facts - everything the report is made of.
 * @returns {string} the report.
 */
export function render(facts) {
  const lines = [`# ${facts.package}: what this change does`, ""]
  lines.push(
    `Measured against \`${facts.base}\`${facts.head === "" ? "" : ` at \`${facts.head}\``}${facts.version === undefined ? "" : `, version ${facts.version}`}.`,
    "",
  )

  if (facts.files.length === 0) {
    lines.push("Nothing differs from the base.", "")
  } else {
    const rows = [...AREAS.map(({ area }) => area), "Configuration"].flatMap((area) => {
      const inArea = facts.files.filter((file) => areaOf(file.path) === area)
      if (inArea.length === 0) return []
      const added = inArea.reduce((sum, file) => sum + file.added, 0)
      const removed = inArea.reduce((sum, file) => sum + file.removed, 0)
      return [[area, String(inArea.length), `+${String(added)}`, `-${String(removed)}`]]
    })
    lines.push("## What changed", "", ...table(["Area", "Files", "Added", "Removed"], rows), "")
  }

  lines.push("## What it means for a release", "")
  if (facts.changesets.length === 0)
    lines.push("No changeset: nothing is released from this change as it stands.", "")
  else {
    for (const set of facts.changesets)
      lines.push(`- \`${set.package}\` **${set.bump}**: ${firstLine(set.summary)}`)
    lines.push("")
  }

  if (facts.decisions.length > 0) {
    lines.push(
      "## Decisions recorded",
      "",
      ...facts.decisions.map(({ file, title }) => `- [${title}](${file})`),
      "",
    )
  }

  if (facts.exceptions.length > 0) {
    lines.push("## Exceptions", "")
    for (const { registry, id, justification, change } of facts.exceptions) {
      lines.push(
        `- **${change}** in \`${registry}\`: \`${id}\`${justification === "" ? "" : ` — ${firstSentence(justification)}`}`,
      )
    }
    lines.push("")
  }

  if (facts.dependencies.length > 0) {
    lines.push("## Dependencies", "")
    for (const { name, field, from, to } of facts.dependencies) {
      const what =
        from === undefined
          ? `added \`${String(to)}\``
          : to === undefined
            ? `removed (was \`${from}\`)`
            : `\`${from}\` to \`${to}\``
      lines.push(`- \`${name}\` (${field}): ${what}`)
    }
    lines.push("")
  }

  lines.push("## What the checks said", "")
  if (facts.checks === undefined) {
    lines.push("The contract has not been run here: run it, then this report again.", "")
  } else {
    const by = new Map(facts.checks.map((check) => [check.id, check]))
    const shown = EVIDENCE.flatMap((id) => {
      const check = by.get(id)
      return check === undefined ? [] : [[id, check.outcome, cell(firstLine(check.rationale))]]
    })
    if (shown.length > 0) lines.push(...table(["Check", "Outcome", "What it says"], shown), "")
    const counts = new Map()
    for (const { outcome } of facts.checks) counts.set(outcome, (counts.get(outcome) ?? 0) + 1)
    lines.push(
      `${String(facts.checks.length)} ${facts.checks.length === 1 ? "check" : "checks"}: ${[...counts].map(([outcome, count]) => `${String(count)} ${outcome}`).join(", ")}.`,
      "",
    )
    const open = facts.checks.filter(({ outcome }) => !["pass", "skipped"].includes(outcome))
    if (open.length > 0) {
      lines.push(
        "Not clean:",
        "",
        ...open.map(
          ({ id, outcome, rationale }) => `- \`${id}\` (${outcome}): ${firstLine(rationale)}`,
        ),
        "",
      )
    }
    const skipped = facts.checks.filter(({ outcome }) => outcome === "skipped")
    if (skipped.length > 0)
      lines.push(`Skipped in this run: ${skipped.map(({ id }) => `\`${id}\``).join(", ")}.`, "")
  }

  lines.push("## Not seen by this report", "", ...CI_ONLY.map((item) => `- ${item}`), "")
  return lines.join("\n")
}
