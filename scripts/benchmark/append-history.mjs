#!/usr/bin/env node
// Appends one compact entry from a results.json to a package's benchmark history file.
//
//   node append-history.mjs <results.json> <history.json> [--commit <sha>] [--pr <number>]
//
// Run by the benchmark-record workflow, which a package calls from its push-to-main CI; never by a local run.
// Each entry keeps, per completed group and tier, the median, the `inputs`, a derived `unitsPerSecond` and the
// spread figures (`stdDevMs`, `p95Ms`, `iterations`). The rest stays reachable through `gitCommit` in that
// commit's own results.json. `--commit` and `--pr` name the merge commit and pull request, because a branch
// head disappears with a squash merge. `versions` is copied whole from `metadata.versions`, whatever keys a
// package uses.
//
// The history schema is version 2: a tier carries `inputs` beside `medianMs`. Older entries are kept as they
// are; classify-complexity.mjs leaves a tier without `inputs` out of its fit on its own. The file's version
// marker says what the newest writer wrote, not what the oldest entry has.

import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { inputTotal } from "./classify-complexity.mjs"
import { readJson, resultsToMeasurements } from "./lib/results.mjs"

/**
 * History schema v2: each tier measurement in `entries[].measurements.<group>.<tier>`
 * gains an `inputs: Record<string, number>` alongside `medianMs`. Schema v1 had only
 * `medianMs`, or env-cap's `medianMs` plus a hardcoded `variablesPerSecond`. Old v1 entries
 * stay valid and are never migrated. Without `inputs`, classify-complexity.mjs leaves them out
 * of complexity classification; the timing chart still shows them, since it needs only `medianMs`.
 *
 * `unitsPerSecond` is a schema-v2 generalization of env-cap's own
 * `variablesPerSecond`. It replaces a hardcoded "divide `inputs.variables` by
 * time", which is meaningless for a group whose `inputs` has no `variables` key
 * (e.g. every one of data-cap's own groups). Instead it divides the SAME generic
 * `inputTotal` this file's own complexity classifier uses by elapsed
 * seconds. One consistent "how much size, how fast" figure per tier,
 * computed the same way regardless of what a consumer's `inputs` object
 * happens to contain.
 */
const HISTORY_SCHEMA_VERSION = 2

const USAGE =
  "Usage: node append-history.mjs <results.json> <history.json> [--commit <sha>] [--pr <number>]"

/**
 * @param {readonly string[]} argv - the arguments after the script name.
 * @returns {{ positional: string[], commit?: string, pullRequest?: number }}
 */
export function parseAppendArgs(argv) {
  const parsed = { positional: [] }
  const items = argv[Symbol.iterator]()
  const value = () => items.next().value
  for (const arg of items) {
    if (arg === "--commit") parsed.commit = value()
    else if (arg === "--pr") {
      const number = Number(value())
      if (Number.isInteger(number) && number > 0) parsed.pullRequest = number
    } else parsed.positional.push(arg)
  }
  return parsed
}

/**
 * Intentionally compact: medianMs + inputs + a generic derived throughput figure per completed
 * (group, tier), plus the three numbers that say how noisy the run was (stdDevMs, p95Ms, iterations).
 * The rest of the per-run detail (min/max/memory) stays reachable via `gitCommit` in that commit's own
 * results.json.
 * @param {{ medianMs: number, inputs?: Record<string, number> }} measurement - one tier's result.
 * @returns {object} the compact tier entry.
 */
function summarizeTier(measurement) {
  const size = inputTotal(measurement.inputs)
  return {
    medianMs: measurement.medianMs,
    ...(measurement.inputs ? { inputs: measurement.inputs } : {}),
    // How noisy the run was: without these a reader cannot tell a real change from the run's own spread.
    ...(Number.isFinite(measurement.stdDevMs) ? { stdDevMs: measurement.stdDevMs } : {}),
    ...(Number.isFinite(measurement.p95Ms) ? { p95Ms: measurement.p95Ms } : {}),
    ...(Number.isFinite(measurement.iterations) ? { iterations: measurement.iterations } : {}),
    ...(size !== undefined && measurement.medianMs > 0
      ? { unitsPerSecond: Math.round((size / (measurement.medianMs / 1000)) * 100) / 100 }
      : {}),
  }
}

/**
 * Builds the history entry for one results.json.
 *
 * `versions` is copied verbatim from results.metadata.versions rather than singling out one "the
 * package's own version" field by a hardcoded key (env-cap's `envCapVersion`, data-cap's
 * `dataCapVersion`, and any future consumer's own naming would each need a special case
 * otherwise). A reader wanting "the package version at this point in history" reads whichever key
 * its own results.json happens to report, e.g. `entry.versions.dataCapVersion`.
 * @param {object} results - a parsed results.json.
 * @param {{ commit?: string, pullRequest?: number }} where - the merge commit and pull request this run belongs to.
 * @returns {object} the entry to append.
 */
export function buildEntry(results, { commit, pullRequest }) {
  const measurements = Object.fromEntries(
    Object.entries(resultsToMeasurements(results)).map(([group, tiers]) => [
      group,
      Object.fromEntries(
        Object.entries(tiers).map(([tier, entry]) => [tier, summarizeTier(entry)]),
      ),
    ]),
  )
  return {
    timestamp: results.metadata?.timing?.finishedAtUtc,
    gitCommit: commit ?? results.metadata?.git?.gitCommit,
    ...(pullRequest === undefined ? {} : { pullRequest }),
    nodeVersion: results.metadata?.environment?.nodeVersion,
    runner: results.metadata?.environment?.runner,
    // The processor, so a reader can tell whether two runs were on comparable hardware.
    ...(results.metadata?.environment?.cpuModel
      ? { cpuModel: results.metadata.environment.cpuModel }
      : {}),
    versions: { ...results.metadata?.versions },
    measurements,
  }
}

/**
 * A file that already exists (schema v1, or a v2 file from an earlier append) keeps its own
 * `entries`. Only the version marker is bumped, to reflect what THIS (newest) entry's shape actually
 * is. A reader already has to tolerate older entries lacking `inputs` (see above). So the
 * top-level marker tracking "the newest writer's schema" rather than "the oldest entry's schema" is
 * the more useful signal.
 * @param {any} history - the parsed history file, or a fresh one.
 * @param {object} entry - the entry to append.
 * @returns {any} the same history, updated.
 */
export function appendEntry(history, entry) {
  history.historySchemaVersion = HISTORY_SCHEMA_VERSION
  history.entries = [...(Array.isArray(history.entries) ? history.entries : []), entry]
  return history
}

/**
 * @param {readonly string[]} argv - the arguments after the script name.
 * @param {{ log: (text: string) => void, error: (text: string) => void }} io - where output goes.
 * @returns {Promise<number>} the process exit code.
 */
export async function run(argv, io) {
  const { positional, commit, pullRequest } = parseAppendArgs(argv)
  const [resultsPath, historyPath] = positional
  if (!resultsPath || !historyPath) {
    io.error(USAGE)
    return 1
  }

  const results = readJson(resultsPath)

  let history
  try {
    history = JSON.parse((await fs.readFile(historyPath)).toString())
  } catch {
    history = {}
  }
  appendEntry(history, buildEntry(results, { commit, pullRequest }))

  await fs.mkdir(path.dirname(historyPath), { recursive: true })
  await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`)
  io.log(
    `[append-history] appended entry to ${historyPath} (${String(history.entries.length)} total, schema v${String(HISTORY_SCHEMA_VERSION)})`,
  )
  return 0
}

// Stryker disable BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression, LogicalOperator, ObjectLiteral: process entry point, exercised only by spawning the script
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv.slice(2), { log: console.log, error: console.error })
    .then((code) => {
      process.exitCode = code
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}
// Stryker restore BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression, LogicalOperator, ObjectLiteral
