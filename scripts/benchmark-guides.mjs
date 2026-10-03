#!/usr/bin/env node
// Keeps a package's copies of the two benchmark guides identical to the canonical ones.
//
// `WRITING-BENCHMARKS.md` and `READING-BENCHMARKS.md` explain how benchmarks are written and read; they
// are the same for every package, so a package carries copies (they sit next to the report that links
// them, and ship with the repository). Four hand-maintained copies drift: they already disagreed with
// the kit about how many sizes it measures and about what the pull-request summary shows. The canonical
// text lives in `template/benchmarks/`; the `BenchmarkGuides` check fails a package whose copy differs,
// and `internal-package-contract sync-benchmark-guides` rewrites them.
//
//   node benchmark-guides.mjs --check    print { ok, differing: [...] } for the cwd
//   node benchmark-guides.mjs --write    copy the canonical guides over the package's copies

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
    else if (readFileSync(copy, "utf8") !== readFileSync(path.join(canonicalDir, guide), "utf8")) {
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
  const { applicable, missing, differing } = compareGuides(cwd, canonicalDir)
  if (!applicable) return []
  const written = [...missing, ...differing]
  for (const guide of written) {
    copyFileSync(path.join(canonicalDir, guide), path.join(cwd, "benchmarks", guide))
  }
  return written
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes("--write")) {
    const written = syncGuides(process.cwd())
    process.stdout.write(
      written.length === 0
        ? "Benchmark guides are already identical to the canonical ones.\n"
        : `Updated ${written.join(", ")}.\n`,
    )
  } else {
    process.stdout.write(JSON.stringify({ ok: true, ...compareGuides(process.cwd()) }))
  }
}
