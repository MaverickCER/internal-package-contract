// The "thresholds" region: the limits the standard holds every package to, read from the constants that set
// them. No document then restates a threshold by hand. The TypeScript constants are read from their source
// text, because this runs in plain Node.js. Only a whole `export const NAME = <number>` declaration counts, so
// a renamed or computed constant stops generation instead of being guessed at. The JavaScript ones are
// imported.

import { readFileSync } from "node:fs"
import path from "node:path"
import { DEFAULT_DAYS } from "../adoption/mode.mjs"
import { DEFAULT_GATES } from "../benchmark/gates.mjs"
import { MAX_LINES } from "../readme/validate.mjs"
import { toTable } from "./entry-points.mjs"

/** This package's root: the standard whose thresholds and checks the regions state. */
export const STANDARD_ROOT = path.resolve(import.meta.dirname, "..", "..")

const NUMBER = String.raw`(\d+(?:\.\d+)?)`
/** Where IPC hardens repo-contract's `strict` tier: every limit below the benchmarks is set there. */
const HARDENING = "checks/strict.ts"
/** @param {string} name - a constant in {@link HARDENING}. @returns {string} the "Set by" cell for it. */
const setBy = (name) => `\`${name}\` in \`${HARDENING}\`, passed to repo-contract's \`strict()\``
const GATES_SOURCE = "`DEFAULT_GATES` in `scripts/benchmark/gates.mjs`. A package may override it."

/**
 * @param {string} root - where the standard's sources are read from.
 * @returns {{ problems: string[], markdown: string }} the region's body, or what stops it being written.
 */
export function thresholdsRegion(root = STANDARD_ROOT) {
  /** @type {string[]} */
  const problems = []
  /** @type {(file: string, name: string) => string | undefined} */
  const source = (file, name) => {
    try {
      return String(readFileSync(path.join(root, file)))
    } catch {
      problems.push(`${file} not found; the "thresholds" region reads ${name} from it.`)
      return undefined
    }
  }
  /** @type {(file: string, name: string) => string} */
  const constant = (file, name) => {
    const text = source(file, name)
    if (text === undefined) return ""
    const match = new RegExp(`^export const ${name} = ${NUMBER};?$`, "m").exec(text)
    if (match !== null) return match[1]
    problems.push(`${file} has no \`export const ${name} = <number>\` for the "thresholds" region.`)
    return ""
  }

  const rows = [["What is measured", "Limit", "Set by"]]
  const coverage = source(HARDENING, "COVERAGE_THRESHOLDS")
  if (coverage !== undefined) {
    const object = /^export const COVERAGE_THRESHOLDS = \{([^}]*)\}/m.exec(coverage)
    if (object === null) {
      problems.push(
        `${HARDENING} has no \`export const COVERAGE_THRESHOLDS = { ... }\` for the "thresholds" region.`,
      )
    } else {
      const metrics = [...object[1].matchAll(new RegExp(String.raw`^\s*(\w+): ${NUMBER},?$`, "gm"))]
      if (metrics.length === 0) {
        problems.push(
          `${HARDENING} sets no number in COVERAGE_THRESHOLDS for the "thresholds" region.`,
        )
      }
      for (const [, metric, value] of metrics) {
        rows.push([`Coverage of ${metric}`, `at least ${value}%`, setBy("COVERAGE_THRESHOLDS")])
      }
    }
  }
  // Read in row order, so the problems come out in that order too.
  const crap = constant(HARDENING, "CRAP_THRESHOLD")
  const complexity = constant(HARDENING, "MAX_COMPLEXITY")
  const duplication = constant(HARDENING, "DUPLICATION_MAX_PERCENTAGE")
  const score = constant(HARDENING, "MUTATION_MIN_SCORE")
  rows.push(
    ["CRAP score of one function", `at most ${crap}`, setBy("CRAP_THRESHOLD")],
    ["Cyclomatic complexity of one function", `at most ${complexity}`, setBy("MAX_COMPLEXITY")],
    [
      "Duplicated share of the code",
      `at most ${duplication}%`,
      setBy("DUPLICATION_MAX_PERCENTAGE"),
    ],
    [
      "Mutation score: mutants detected, or covered by a record",
      // No score is above 100, so "at least" would promise a margin that cannot exist.
      score === "100" ? "100%" : `at least ${score}%`,
      setBy("MUTATION_MIN_SCORE"),
    ],
  )
  const gates = DEFAULT_GATES.normalizedOverheadMaxIncreasePercent
  rows.push(
    [
      `Benchmark overhead growth, work of ${String(gates.microscaleBelowMs)} ms or more`,
      `at most ${String(gates.millisecondScale)}%`,
      GATES_SOURCE,
    ],
    [
      `Benchmark overhead growth, work under ${String(gates.microscaleBelowMs)} ms`,
      `at most ${String(gates.microsecondScale)}%`,
      GATES_SOURCE,
    ],
    [
      "README length of a published package",
      `at most ${String(MAX_LINES)} lines`,
      "`MAX_LINES` in `scripts/readme/validate.mjs`",
    ],
    [
      "Adoption period",
      `${String(DEFAULT_DAYS)} days`,
      "`DEFAULT_DAYS` in `scripts/adoption/mode.mjs`",
    ],
  )
  return { problems, markdown: toTable(rows) }
}
