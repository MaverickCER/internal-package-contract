#!/usr/bin/env node
// What the `BenchmarkGuides` check reads, and what `sync-benchmark-guides` writes.
//
// The check compares `benchmarks/WRITING-BENCHMARKS.md` and `benchmarks/READING-BENCHMARKS.md` with the
// copies this package ships in `template/benchmarks/`. A missing or differing copy fails the check. A package
// with no `benchmarks/` directory is not applicable and passes. There is no exception registry for it:
// `npx internal-package-contract sync-benchmark-guides` rewrites the copies, and the bundled text is the only
// source. The check is in the standard set, so it runs in a consumer's contract job and git hooks; this
// repository's own contract leaves it out.
//
//   node benchmark-guides.mjs            print { ok, applicable, missing, differing } for the cwd
//   node benchmark-guides.mjs --write    copy the canonical guides over the package's copies
//
// Any argument other than `--write` compares; the check passes `--check` for readability only.

import { copyFileSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** The guides every package carries, relative to its `benchmarks/` directory. */
export const GUIDES = ["WRITING-BENCHMARKS.md", "READING-BENCHMARKS.md"]

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const CANONICAL_DIR = path.join(packageRoot, "template", "benchmarks")

/**
 * @param {string} cwd - the package's root.
 * @param {string} [canonicalDir]
 * @returns {{ applicable: boolean, missing: string[], differing: string[] }} `applicable` is false for a package with no benchmarks directory.
 */
export function compareGuides(cwd, canonicalDir = CANONICAL_DIR) {
  const dir = path.join(cwd, "benchmarks")
  if (!existsSync(dir)) return { applicable: false, missing: [], differing: [] }
  const missing = []
  const differing = []
  for (const guide of GUIDES) {
    const copy = path.join(dir, guide)
    if (!existsSync(copy)) missing.push(guide)
    else if (
      readFileSync(copy).toString() !== readFileSync(path.join(canonicalDir, guide)).toString()
    ) {
      differing.push(guide)
    }
  }
  return { applicable: true, missing, differing }
}

/**
 * Copies the canonical guides over (or into) the package's `benchmarks/` directory.
 * @param {string} cwd
 * @param {string} [canonicalDir]
 * @returns {string[]} the guides written.
 */
export function syncGuides(cwd, canonicalDir = CANONICAL_DIR) {
  // Not applicable (no benchmarks directory) reports nothing missing or differing, so nothing is written.
  const { missing, differing } = compareGuides(cwd, canonicalDir)
  const written = [...missing, ...differing]
  for (const guide of written) {
    copyFileSync(path.join(canonicalDir, guide), path.join(cwd, "benchmarks", guide))
  }
  return written
}

/**
 * The command's body.
 * @param {readonly string[]} argv - the arguments after the script name (`--write` copies; otherwise it compares).
 * @param {string} cwd - the package's root.
 * @param {(text: string) => void} write - where output goes.
 */
export function run(argv, cwd, write) {
  if (argv.includes("--write")) {
    const written = syncGuides(cwd)
    write(
      written.length === 0
        ? "Benchmark guides are already identical to the canonical ones.\n"
        : `Updated ${written.join(", ")}.\n`,
    )
  } else {
    write(JSON.stringify({ ok: true, ...compareGuides(cwd) }))
  }
}

// Stryker disable BlockStatement, ConditionalExpression, CallExpression, LogicalOperator, MethodExpression, ArrowFunction: process entry point, exercised only by spawning the script
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv.slice(2), process.cwd(), (text) => process.stdout.write(text))
}
// Stryker restore BlockStatement, ConditionalExpression, CallExpression, LogicalOperator, MethodExpression, ArrowFunction
