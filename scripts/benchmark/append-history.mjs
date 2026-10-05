#!/usr/bin/env node
// Extracts a compact entry from a fresh results.json and appends it to a
// consumer-owned history JSON file (env-cap's docs/benchmark-history/<name>.json,
// data-cap's benchmarks/history/<name>.json, or wherever a future consumer
// points it -- this script takes both paths as arguments and makes no
// assumption about either one's location or naming). Generalizes env-cap's
// and data-cap's own (near-identical) scripts/append-benchmark-history.mjs /
// benchmarks/append-benchmark-history.mjs: same "called only by the
// benchmark-pr job, only when the PR's diff touches benchmarked code, never
// by a local run" contract, same compact-entry intent, but now carries each
// tier's full `inputs` object through (schema v2 -- see below) instead of
// deriving one hardcoded throughput figure (env-cap's `variablesPerSecond`)
// and discarding the rest.
//
// Usage: node append-history.mjs <results.json> <history.json> [--commit <sha>] [--pr <number>]
//
// `--commit` and `--pr` say where the run belongs on main: the MERGE commit it measured and the pull
// request that produced it. Without them an entry would carry the pull-request branch's head, which
// disappears with a squash merge and so cannot be traced afterwards.

import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { inputTotal } from "./classify-complexity.mjs"
import { readJson, resultsToMeasurements } from "./lib/results.mjs"

/**
 * History schema v2: each tier measurement in `entries[].measurements.<group>.<tier>`
 * gains an `inputs: Record<string, number>` alongside `medianMs` (schema v1
 * had only `medianMs`, or env-cap's `medianMs` + a hardcoded
 * `variablesPerSecond`). Old v1 entries remain valid as-is -- nothing here
 * back-fills or migrates them; they simply lack `inputs` and are excluded
 * from complexity classification by classify-complexity.mjs's own filtering
 * (never from the timing chart, which only ever needed `medianMs`).
 *
 * `unitsPerSecond` is a schema-v2 generalization of env-cap's own
 * `variablesPerSecond`: instead of a hardcoded "divide `inputs.variables` by
 * time" (meaningless for a group whose `inputs` has no `variables` key --
 * e.g. every one of data-cap's own groups), it divides the SAME generic
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
 * (group, tier), not the full per-run detail (min/max/stdDev/memory) already reachable via
 * `gitCommit` in that commit's own results.json. Duplicating all of that here would make this file
 * grow unboundedly for no benefit.
 * @param {{ medianMs: number, inputs?: Record<string, number> }} measurement - one tier's result.
 * @returns {object} the compact tier entry.
 */
function summarizeTier(measurement) {
  const size = inputTotal(measurement.inputs)
  return {
    medianMs: measurement.medianMs,
    ...(measurement.inputs ? { inputs: measurement.inputs } : {}),
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
    versions: { ...results.metadata?.versions },
    measurements,
  }
}

/**
 * A file that already exists (schema v1, or a v2 file from an earlier append) keeps its own
 * `entries`; only the version marker is bumped to reflect what THIS (newest) entry's shape actually
 * is -- a reader already has to tolerate older entries lacking `inputs` (see above), so the
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
