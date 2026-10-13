// Badge data for the Pages site: reads coverage/coverage-summary.json (the coverage reporter's "json-summary")
// and coverage/size-summary.json (`size --json`), and writes shields.io "endpoint badge" JSON into docs/.
// Never runs against stale or missing inputs silently: each section fails loudly rather than writing a
// badge from nothing.
//
// The size badge shows the entry point named by `"badges": { "sizeEntry": "<label>" }` under
// "internal-package-contract" in package.json, else the first one in the summary.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import {
  COVERAGE_HEADLINE,
  COVERAGE_MEANING,
  COVERAGE_METRICS,
  SIZE_MEANING,
} from "../badges/meaning.mjs"

/** @param {number} pct */
export function coverageColor(pct) {
  if (pct >= 85) return "brightgreen"
  return pct >= 70 ? "yellow" : "red"
}

/**
 * @param {number} gz
 * @param {number} max
 */
export function sizeColor(gz, max) {
  if (gz <= max) return "brightgreen"
  return gz <= max * 1.1 ? "yellow" : "red"
}

/**
 * @param {readonly string[]} argv - `--coverage <file>` to read another coverage summary, `--no-size` for a package with no size budget.
 * @param {string} cwd - the package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io) {
  let coverageFile = "coverage/coverage-summary.json"
  let withSize = true
  const items = argv[Symbol.iterator]()
  for (const arg of items) {
    if (arg === "--coverage") coverageFile = String(items.next().value)
    else if (arg === "--no-size") withSize = false
    else {
      io.err(`[badges] unknown argument: ${arg}\nUsage: badges [--coverage <file>] [--no-size]\n`)
      return 2
    }
  }
  let code = 0
  const write = (name, badge) =>
    writeFileSync(
      path.join(cwd, "docs", name),
      JSON.stringify({ schemaVersion: 1, ...badge }, null, 2),
    )

  const summary = path.join(cwd, coverageFile)
  if (!existsSync(summary)) {
    io.err(`[badges] ${coverageFile} missing -- run the tests with coverage first.\n`)
    code = 1
  } else {
    const { total } = JSON.parse(readFileSync(summary).toString())
    // The headline is the MINIMUM of the four metrics, so one low number is never masked by three higher ones.
    const pct = Math.min(...COVERAGE_METRICS.map((metric) => total[metric].pct))
    write("coverage-badge.json", {
      label: "coverage",
      message: `${pct.toFixed(1)}% (lowest of 4)`,
      color: coverageColor(pct),
    })
    // The same number, with what it is and every value it summarises.
    write("coverage.json", {
      headline: {
        value: Number(pct.toFixed(1)),
        statistic: "minimum",
        of: COVERAGE_METRICS,
        meaning: COVERAGE_HEADLINE,
      },
      metrics: Object.fromEntries(
        COVERAGE_METRICS.map((metric) => [
          metric,
          {
            percent: total[metric].pct,
            covered: total[metric].covered,
            total: total[metric].total,
            meaning: COVERAGE_MEANING[metric],
          },
        ]),
      ),
    })
    io.out(`[badges] wrote docs/coverage-badge.json and docs/coverage.json (${pct.toFixed(1)}%)\n`)
  }

  if (!withSize) return code
  const sizes = path.join(cwd, "coverage/size-summary.json")
  if (!existsSync(sizes)) {
    io.err("[badges] size summary missing -- run `size --json coverage/size-summary.json` first.\n")
    return 1
  }
  const { entries } = JSON.parse(readFileSync(sizes).toString())
  const wanted = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())[
    "internal-package-contract"
  ]?.badges?.sizeEntry
  const entry = wanted === undefined ? entries[0] : entries.find((e) => e.label === wanted)
  if (entry?.gzipBytes == null) {
    io.err(`[badges] ${wanted ?? "the first"} entry is missing gzipBytes in size-summary.json.\n`)
    return 1
  }
  const kb = (entry.gzipBytes / 1024).toFixed(2)
  const budget =
    entry.maxGzipBytes === undefined ? undefined : (entry.maxGzipBytes / 1024).toFixed(2)
  write("size-badge.json", {
    label: "gzip size",
    message: budget === undefined ? `${kb} KB` : `${kb} KB of ${budget} KB`,
    color: sizeColor(entry.gzipBytes, entry.maxGzipBytes),
  })
  write("size.json", {
    headline: {
      value: Number(kb),
      unit: "KB",
      statistic: "gzip size of one entry point",
      meaning: SIZE_MEANING,
    },
    entry: { label: entry.label, gzipBytes: entry.gzipBytes, maxGzipBytes: entry.maxGzipBytes },
  })
  io.out(`[badges] wrote docs/size-badge.json and docs/size.json (${kb} KB)\n`)
  return code
}
