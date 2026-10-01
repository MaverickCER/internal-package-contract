#!/usr/bin/env node
// Runs a benchmark suite and writes its results and report.
//
//   node run-suite.mjs <suite.mjs> [--quick] [--check] [--only a,b] [--out <dir>] [--config <file>]
//
//   --render  re-render BENCHMARKS.md from the existing results.json (no measuring)
//   --check   validate the suite's documentation and shape, measure nothing (cheap enough for CI)
//   --quick   5 smaller sizes and short sampling -- a smoke test, never for committed results
//   --only    run just these benchmark ids (use `end-to-end` for the end-to-end pair)
//   --out     where to write results.json and BENCHMARKS.md (default: the suite's own directory)
//   --config  benchmark.config.json: { costRates?, bundleFiles?, root?, docsPath? } (default: next to the suite)
//
// Re-launches itself under `node --expose-gc` when needed so garbage from one sample is not billed
// to the next.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { renderReport } from "./kit/report.mjs"
import { analyze, runSuite } from "./kit/run.mjs"
import { validateResults } from "./kit/results-contract.mjs"
import { SuiteDefinitionError } from "./kit/define.mjs"

function parse(argv) {
  const options = {
    quick: false,
    check: false,
    only: [],
    suite: undefined,
    out: undefined,
    config: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--quick") options.quick = true
    else if (arg === "--check") options.check = true
    else if (arg === "--render") options.render = true
    else if (arg === "--only") options.only = (argv[++index] ?? "").split(",").filter(Boolean)
    else if (arg === "--out") options.out = argv[++index]
    else if (arg === "--config") options.config = argv[++index]
    else if (!arg.startsWith("--") && options.suite === undefined) options.suite = arg
    else throw new Error(`Unknown argument ${JSON.stringify(arg)}.`)
  }
  return options
}

async function main() {
  const options = parse(process.argv.slice(2))
  if (!options.suite) {
    console.error(
      "Usage: node run-suite.mjs <suite.mjs> [--quick] [--check] [--only a,b] [--out <dir>] [--config <file>]",
    )
    process.exitCode = 1
    return
  }

  if (!options.check && !options.render && typeof global.gc !== "function") {
    const relaunch = spawnSync(
      process.execPath,
      ["--expose-gc", ...process.execArgv, ...process.argv.slice(1)],
      {
        stdio: "inherit",
      },
    )
    process.exitCode = relaunch.status ?? 1
    return
  }

  const suitePath = path.resolve(options.suite)
  const outDir = path.resolve(options.out ?? path.dirname(suitePath))
  const configPath = path.resolve(
    options.config ?? path.join(path.dirname(suitePath), "benchmark.config.json"),
  )
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {}
  const root = path.resolve(path.dirname(configPath), config.root ?? "..")

  let suite
  try {
    suite = (await import(pathToFileURL(suitePath).href)).default
  } catch (error) {
    if (error instanceof SuiteDefinitionError) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  }

  if (options.check) {
    console.log(
      `Suite for ${suite.package.name} is valid: ${String(suite.functions.length)} documented function(s), ${String(suite.tiers.length)} sizes.`,
    )
    return
  }

  if (options.render) {
    const existing = JSON.parse(readFileSync(path.join(outDir, "results.json"), "utf8"))
    // Re-derive the analysis from the stored measurements, so a documentation fix (an expected
    // complexity, a call count) is reflected without measuring again.
    existing.analysis = analyze({
      suite,
      results: existing.results,
      tiers: existing.metadata.tiers,
      rates: existing.metadata.costRates,
    })
    writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(existing, null, 2)}\n`)
    writeFileSync(
      path.join(outDir, "BENCHMARKS.md"),
      `${renderReport(existing, suite, { docsPath: config.docsPath })}\n`,
    )
    console.log(
      `Re-analyzed results.json and re-rendered ${path.join(outDir, "BENCHMARKS.md")} (nothing was measured)`,
    )
    return
  }

  const results = await runSuite(suite, {
    quick: options.quick,
    only: options.only,
    rates: config.costRates,
    bundleFiles: config.bundleFiles,
    root,
    onProgress: (message) => process.stderr.write(`  ${message}\n`),
  })
  const violations = validateResults(results)
  if (violations.length > 0) {
    console.error(
      `The results do not match the documented output shape:\n${violations.map((v) => `- ${v}`).join("\n")}`,
    )
    process.exitCode = 1
    return
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`)
  writeFileSync(
    path.join(outDir, "BENCHMARKS.md"),
    `${renderReport(results, suite, { docsPath: config.docsPath })}\n`,
  )
  console.log(
    `Wrote ${path.join(outDir, "results.json")} and ${path.join(outDir, "BENCHMARKS.md")}`,
  )
}

await main()
