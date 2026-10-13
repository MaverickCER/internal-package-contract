// A mutant that timed out is not always a mutant that loops. On a machine that is swapping, or whose process is paused,
// the one test run that happened to be going when it stalled takes minutes, and the mutant is reported as a timeout
// that fails the check. That is a different mutant in every run, and none of them times out when run alone.
//
// Before a timeout counts, this runs that one mutant again, alone, with nothing else going. A mutant that is caught
// the second time is caught (the evidence is changed, and says so); one that times out again really does loop
// or hang, and stays what it was. Only a handful are ever re-run: a run with many timeouts is not a stall.

import { spawnSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"

/** The most timeouts that are re-run. More than this is a broken run, and it is left as it is. */
export const MAXIMUM_CONFIRMED = 5

/** @typedef {{ status?: string, mutatorName?: string, replacement?: string, statusReason?: string, location: { start: { line: number, column: number }, end: { line: number } } }} Mutant */
/** @typedef {{ files: Record<string, { mutants: Mutant[] }> }} Report */

/**
 * @param {Report} report - the evidence of a run.
 * @returns {{ file: string, mutant: Mutant }[]} every mutant that timed out.
 */
export function timedOut(report) {
  return Object.entries(report.files).flatMap(([file, entry]) =>
    entry.mutants
      .filter((mutant) => mutant.status === "Timeout")
      .map((mutant) => ({ file, mutant })),
  )
}

/**
 * @param {Mutant} mutant
 * @param {Mutant} other
 * @returns {boolean} whether they are the same mutation of the same code.
 */
export function same(mutant, other) {
  return (
    mutant.mutatorName === other.mutatorName &&
    mutant.replacement === other.replacement &&
    mutant.location.start.line === other.location.start.line &&
    mutant.location.start.column === other.location.start.column
  )
}

/** What a re-run says about the mutants it was asked about. */
export const REASON = "timed out in the full run and was caught when run alone"

/**
 * @param {Report} report - the evidence of a run; changed in place.
 * @param {(file: string, from: number, to: number) => Report | undefined} rerun - runs the mutants on those lines alone.
 * @returns {{ confirmed: number, caught: number }} how many timeouts were re-run, and how many of them were caught.
 */
export function confirmTimeouts(report, rerun) {
  const timeouts = timedOut(report)
  if (timeouts.length > MAXIMUM_CONFIRMED) return { confirmed: 0, caught: 0 }
  let caught = 0
  for (const { file, mutant } of timeouts) {
    const again = rerun(file, mutant.location.start.line, mutant.location.end.line)
    const now = again?.files[file]?.mutants.find((candidate) => same(candidate, mutant))
    if (now !== undefined && now.status !== "Timeout" && now.status !== undefined) {
      mutant.status = now.status
      mutant.statusReason = REASON
      caught += 1
    }
  }
  return { confirmed: timeouts.length, caught }
}

/**
 * Runs Stryker on one range of lines, alone, and reads its report. Stryker writes the report where the full run did,
 * so the caller keeps the full run's own report and puts it back (see {@link confirmEvidence}).
 * @param {string} cwd - the package.
 * @param {string[]} common - the arguments the full run used, without the ones that choose what to mutate and report.
 * @param {string} evidence - where Stryker writes its report.
 * @param {(command: string, args: string[], options: { cwd: string, stdio: "ignore" }) => unknown} [spawn]
 * @returns {(file: string, from: number, to: number) => Report | undefined} the re-run.
 */
// Stryker disable BlockStatement: equivalent -- an empty handler returns undefined, which is how a re-run with no report is reported.
export function strykerRerun(cwd, common, evidence, spawn = spawnSync) {
  return (file, from, to) => {
    try {
      rmSync(evidence, { force: true })
      spawn(
        "stryker",
        [
          ...common,
          "--reporters",
          "json",
          "--force",
          "--concurrency",
          "1",
          "--mutate",
          `${file}:${String(from)}-${String(to)}`,
        ],
        { cwd, stdio: "ignore" },
      )
      return JSON.parse(readFileSync(evidence).toString())
    } catch {
      // No report: the mutant stays what the full run said it was.
      return undefined
    }
  }
}

// Stryker restore BlockStatement

/**
 * Confirms the timeouts in the evidence file, and writes it back when any changed.
 * @param {string} evidence - the path of the evidence file.
 * @param {(file: string, from: number, to: number) => Report | undefined} rerun
 * @returns {{ confirmed: number, caught: number }}
 */
export function confirmEvidence(evidence, rerun) {
  let report
  try {
    report = JSON.parse(readFileSync(evidence).toString())
  } catch {
    // Nothing to confirm.
    return { confirmed: 0, caught: 0 }
  }
  const result = confirmTimeouts(report, rerun)
  // The re-runs wrote their own reports where the full run's was: put the full run's back, with what they found.
  if (result.confirmed > 0) writeFileSync(evidence, JSON.stringify(report))
  return result
}
