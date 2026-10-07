// Makes `@stryker-mutator/vitest-runner` work with Vitest 5, until upstream ships the fix.
//
// Vitest 5 changed `testNamePattern` to match the suite chain and the test name joined by ` > `
// (https://vitest.dev/guide/migration/). The runner builds that pattern from test names it joins with a
// single space, so on Vitest 5 the pattern matches nothing: every mutant with per-test coverage runs zero
// tests and is reported as Survived, and the mutation score collapses (measured here: 0 of 489 killed
// on Vitest 5 against 489 of 489 on Vitest 4, same file, same tests). Tracked upstream as
// stryker-mutator/stryker-js#6210, with fixes in #6214 and #6220 that are not released yet.
//
// The fix is one expression in the two files the runner uses to build and to record test names:
//
//   nameParts.join(' ').trim()   ->   nameParts.join(' > ').trim()
//
// This module applies exactly that, only when Vitest 5 or later is installed, only when both files carry
// the old expression, and never twice. Once a runner release ships the upstream fix (it injects
// `testNameSeparator` instead), the step recognises that and does nothing.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

/** The expression the runner ships with. */
export const LEGACY_JOIN = "nameParts.join(' ').trim()"

/** The same expression with the separator Vitest 5 matches on. */
export const VITEST_5_JOIN = "nameParts.join(' > ').trim()"

/** A name only the upstream fix introduces; its presence means the runner needs no help. */
export const UPSTREAM_FIX_MARKER = "testNameSeparator"

/** The runner files, relative to the directory of its entry point, that build or record test names. */
export const RUNNER_FILES = ["test-helpers.js", "stryker-setup.js"]

/**
 * @param {string} version - a semver string such as `5.0.3`.
 * @returns {number | undefined} its major number, or undefined when it does not start with one.
 */
export function majorOf(version) {
  const match = /^(\d+)\./.exec(version)
  return match === null ? undefined : Number(match[1])
}

/**
 * @param {string} text - the contents of one runner file.
 * @returns {"patched" | "needs-patch" | "upstream-fixed" | "unrecognised"} what state that file is in.
 */
export function classify(text) {
  if (text.includes(VITEST_5_JOIN)) return "patched"
  if (text.includes(LEGACY_JOIN)) return "needs-patch"
  if (text.includes(UPSTREAM_FIX_MARKER)) return "upstream-fixed"
  return "unrecognised"
}

/**
 * Every directory from `cwd` up to the filesystem root, nearest first.
 * Built as a finite list from the path's own segments, so walking it cannot run unbounded.
 * @param {string} cwd - where to start.
 * @returns {string[]} the directories.
 */
export function ancestorsOf(cwd) {
  const absolute = path.resolve(cwd)
  const { root } = path.parse(absolute)
  const relative = path.relative(root, absolute)
  const segments = relative === "" ? [] : relative.split(path.sep)
  return Array.from({ length: segments.length + 1 }, (_, up) =>
    path.join(root, ...segments.slice(0, segments.length - up)),
  )
}

/**
 * Walks up from a directory the way Node resolves packages, and returns the first install of `name`.
 * Done by hand because the runner is ESM-only, so `require.resolve` cannot reach it.
 * @param {string} cwd - where to start.
 * @param {string} name - the package name, e.g. `vitest` or `@stryker-mutator/vitest-runner`.
 * @param {(file: string) => boolean} exists - whether a path exists.
 * @returns {string | undefined} the package's directory, or undefined when no ancestor has it.
 */
export function findPackageDir(cwd, name, exists) {
  return ancestorsOf(cwd)
    .map((dir) => path.join(dir, "node_modules", name))
    .find((candidate) => exists(path.join(candidate, "package.json")))
}

/**
 * @typedef {object} CompatIo
 * @property {(file: string) => boolean} exists
 * @property {(file: string) => string} readFile
 * @property {(file: string, text: string) => void} writeFile
 */

/**
 * @typedef {object} CompatResult
 * @property {"not-needed" | "patched" | "already-patched" | "upstream-fixed" | "unrecognised"} status
 * @property {string | undefined} vitestVersion - the installed Vitest version, when there is one.
 * @property {string[]} patched - the runner files this call rewrote.
 */

/**
 * Brings the installed Stryker Vitest runner in line with Vitest 5 when it needs it.
 * @param {string} cwd - the project root whose `node_modules` hold Vitest and the runner.
 * @param {CompatIo} io - file access; defaults to the real file system.
 * @returns {CompatResult} what was found and what was done.
 */
export function ensureStrykerVitest5Compat(
  cwd,
  io = {
    exists: existsSync,
    readFile: (file) => readFileSync(file, "utf8"),
    writeFile: (file, text) => writeFileSync(file, text),
  },
) {
  const vitestDir = findPackageDir(cwd, "vitest", io.exists)
  const runnerDir = findPackageDir(cwd, "@stryker-mutator/vitest-runner", io.exists)
  if (vitestDir === undefined || runnerDir === undefined) {
    return { status: "not-needed", vitestVersion: undefined, patched: [] }
  }

  const vitestVersion = JSON.parse(io.readFile(path.join(vitestDir, "package.json"))).version
  const major = majorOf(vitestVersion)
  if (major === undefined || major < 5) return { status: "not-needed", vitestVersion, patched: [] }

  const files = RUNNER_FILES.map((name) => path.join(runnerDir, "dist", "src", name))
  const texts = files.map((file) => io.readFile(file))
  const states = texts.map(classify)

  if (states.every((state) => state === "upstream-fixed")) {
    return { status: "upstream-fixed", vitestVersion, patched: [] }
  }
  if (states.every((state) => state === "patched")) {
    return { status: "already-patched", vitestVersion, patched: [] }
  }
  // Rewrite only when every file is one we understand: patching one of two would leave the names the
  // setup file records and the pattern the runner builds from them out of step.
  if (!states.every((state) => state === "patched" || state === "needs-patch")) {
    return { status: "unrecognised", vitestVersion, patched: [] }
  }

  const patched = []
  files.forEach((file, index) => {
    if (states[index] !== "needs-patch") return
    io.writeFile(file, texts[index].replace(LEGACY_JOIN, VITEST_5_JOIN))
    patched.push(file)
  })
  return { status: "patched", vitestVersion, patched }
}
