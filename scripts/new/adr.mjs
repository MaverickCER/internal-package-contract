// `internal-package-contract new adr "<title>"`: starts a decision record with the next number and the
// sections every record in this standard has, each with the question a good answer starts from.
//
// The questions are prompts (see scripts/prompts/scan.mjs): they warn until answered and fail a release.
// It never overwrites a file, and it writes only inside the package's own decision folder.

import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { adrDirectory } from "../prompts/scan.mjs"

const USAGE = 'Usage: internal-package-contract new adr "<title>"\n'

/**
 * @param {string} title
 * @returns {string} a file-name-safe slug.
 */
export function slugOf(title) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      // Runs of other characters are already one dash, so at most one dash can open or close the slug.
      .replace(/^-|-$/g, "")
  )
}

/**
 * @param {string[]} names - the file names already in the decision folder.
 * @returns {number} the next record number.
 */
export function nextNumber(names) {
  const numbers = names.flatMap((name) => {
    const match = /^(\d{4})-/.exec(name)
    return match === null ? [] : [Number(match[1])]
  })
  return Math.max(0, ...numbers) + 1
}

/**
 * @param {number} number
 * @param {string} title
 * @returns {string} the text of a new record.
 */
export function renderAdr(number, title) {
  const prompt = (text) => `<!-- ipc:prompt: ${text} -->`
  return `# ${String(number).padStart(4, "0")}: ${title}

## Status

Proposed.

${prompt("Who proposed this, and from when does it apply? Name the record it supersedes, if any.")}

## Context

${prompt("What forces make this necessary now? What breaks if nothing changes? Which constraints are fixed?")}

## Decision

${prompt("What exactly changes? What is out of scope? What evidence supports it?")}

## Consequences

${prompt("Who is affected? What gets harder? What should be monitored? How is it reversed?")}

## Alternatives considered

${prompt("Why does each alternative fail against the forces above, and what would make you revisit it?")}
`
}

/**
 * @param {readonly string[]} argv - what follows `new`.
 * @param {string} cwd - the package root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io) {
  const [kind, ...words] = argv
  const title = words.join(" ").trim()
  if (kind !== "adr" || title === "") {
    io.err(
      `[new] ${kind === "adr" ? "a title is needed" : `unknown record type: ${kind ?? "(none given)"}. Available: adr`}.\n${USAGE}`,
    )
    return 2
  }
  const slug = slugOf(title)
  if (slug === "") {
    io.err(`[new] the title has no letters or digits to name the file after.\n${USAGE}`)
    return 2
  }
  const directory = adrDirectory(cwd)
  if (directory === undefined) {
    io.err(
      "[new] this package has no decision folder (specs/decisions, docs/decisions or docs/adr). Create one first.\n",
    )
    return 1
  }
  const number = nextNumber(readdirSync(path.join(cwd, directory)))
  const file = `${directory}/${String(number).padStart(4, "0")}-${slug}.md`
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
  // The number is one past the highest in the folder, so the file cannot already exist.
  writeFileSync(path.join(cwd, file), renderAdr(number, title))
  io.out(
    `[new] wrote ${file}. Answer the prompts in it; \`PromptBlocks\` fails a release until you do.\n`,
  )
  return 0
}
