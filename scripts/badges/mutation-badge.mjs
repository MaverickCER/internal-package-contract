// The mutation badge every package publishes beside its coverage badge. The score is the share of
// applicable mutants the tests detect: Killed, RuntimeError and CompileError count as detected, Ignored
// mutants leave the denominator, and every other status (Survived, NoCoverage, Timeout) stays in it, so a
// timeout lowers the score exactly as a survivor does.
//
//   node node_modules/internal-package-contract/scripts/run-mutation-badge.mjs [--report reports/mutation/mutation.json] [--out docs/mutation-badge.json]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const DETECTED = new Set(["Killed", "RuntimeError", "CompileError"])
const APPLICABLE = new Set([...DETECTED, "Survived", "NoCoverage", "Timeout"])
const USAGE =
  "Usage: run-mutation-badge [--report reports/mutation/mutation.json] [--out docs/mutation-badge.json]\n"

/**
 * @param {{ files?: Record<string, { mutants?: { status: string }[] }> }} report - a Stryker JSON report.
 * @returns {number | undefined} the score in percent, or undefined when no mutant was applicable.
 */
export function mutationScore(report) {
  const mutants = Object.values(report.files ?? {}).flatMap((file) => file.mutants ?? [])
  const applicable = mutants.filter((mutant) => APPLICABLE.has(mutant.status))
  if (applicable.length === 0) return undefined
  return (
    (applicable.filter((mutant) => DETECTED.has(mutant.status)).length / applicable.length) * 100
  )
}

/**
 * @param {number} percent
 * @returns {{ schemaVersion: 1, label: string, message: string, color: string }} a shields.io endpoint badge.
 */
export function mutationBadge(percent) {
  const color = percent >= 95 ? "brightgreen" : percent >= 80 ? "yellow" : "red"
  return { schemaVersion: 1, label: "mutation", message: `${percent.toFixed(1)}%`, color }
}

function parseArgs(argv) {
  const args = {
    report: "reports/mutation/mutation.json",
    out: "docs/mutation-badge.json",
    errors: [],
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--report" || arg === "--out") args[arg.slice(2)] = argv[(i += 1)]
    else args.errors.push(arg)
  }
  return args
}

/**
 * @param {readonly string[]} argv
 * @param {string} cwd - the package root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io) {
  const args = parseArgs(argv)
  if (args.errors.length > 0) {
    io.err(`[mutation-badge] unknown argument: ${args.errors[0]}\n${USAGE}`)
    return 2
  }
  const reportPath = path.resolve(cwd, args.report)
  let report
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"))
  } catch {
    io.err(
      `[mutation-badge] ${args.report} is missing or not JSON. Run the mutation suite first, so the badge is never written from nothing.\n`,
    )
    return 1
  }
  const percent = mutationScore(report)
  if (percent === undefined) {
    io.err(
      `[mutation-badge] ${args.report} has no applicable mutants, so there is nothing to score.\n`,
    )
    return 1
  }
  const outPath = path.resolve(cwd, args.out)
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(mutationBadge(percent), null, 2)}\n`)
  io.out(`[mutation-badge] wrote ${args.out} (${percent.toFixed(1)}%)\n`)
  return 0
}
