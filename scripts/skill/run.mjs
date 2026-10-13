// `internal-package-contract skill`: writes a package's agent skill from docs/skill.json and what the package
// already says about itself, or with --check says whether what is written is current.

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { readFacts } from "./facts.mjs"
import { inspectSkill } from "./inspect.mjs"
import { rawLink } from "./render.mjs"

const USAGE = "Usage: internal-package-contract skill [--check]\n"

/**
 * @param {string[]} argv - the arguments after the command.
 * @param {string} cwd - the package.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io) {
  const [first, ...rest] = argv
  if (rest.length > 0 || (first !== undefined && first !== "--check")) {
    io.err(`skill: unknown argument ${String(rest[0] ?? first)}.\n${USAGE}`)
    return 1
  }
  const report = inspectSkill(cwd)
  for (const note of report.notes) io.out(`[skill] note: ${note}.\n`)
  if (report.problems.length > 0) {
    io.err(`[skill] ${report.problems.map((problem) => `- ${problem}`).join("\n")}\n`)
    return 1
  }
  if (first === "--check") {
    if (report.stale.length > 0) {
      io.err(
        `[skill] stale: ${report.stale.join(", ")}. Run \`npx internal-package-contract skill\` and commit the result.\n`,
      )
      return 1
    }
    io.out(`[skill] current: ${String(report.words)} of ${String(report.budget)} words.\n`)
    return 0
  }
  for (const [file, text] of Object.entries(report.files)) {
    if (!report.stale.includes(file)) continue
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
    writeFileSync(path.join(cwd, file), text)
    io.out(`[skill] wrote ${file}\n`)
  }
  const facts = readFacts(cwd)
  io.out(
    `[skill] ${String(report.words)} of ${String(report.budget)} words. Give an agent: ${rawLink(facts.repository, facts.name)}\n`,
  )
  return 0
}
