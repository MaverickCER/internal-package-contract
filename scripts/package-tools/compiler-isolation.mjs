// Release-blocking check: the bundled TypeScript compiler (`bundleDependencies`) belongs to the build-time
// scanner and to nothing else.
//
// A consumer who only imports the runtime must never load, or pay for the bytes of, a compiler. This walks
// the static import graph of every built entry point in `dist/` and fails if
//
//   - any client entry (every exported entry point except `./build`, and not the CLI) can reach the compiler
//     loader, the bundled package, or `node:module` (the loader's `createRequire`), or
//   - a client entry imports `typescript` itself (the ESLint plugin is exempt: it runs inside the consumer's
//     own ESLint/typescript-eslint process and takes the consumer's `typescript` by design), or
//   - the build entry does NOT reach the bundled compiler (which would make this check vacuous).
//
// Run after the build. Works on the built output, so it also covers whatever chunk-splitting the bundler
// decides to share between entries.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/** What a client entry must never be able to reach. */
export const COMPILER_MARKERS = Object.freeze([
  "@typescript/typescript6",
  "@typescript/old",
  "node:module",
])
/** Entries that legitimately import the consumer's own `typescript`. */
const MAY_IMPORT_TYPESCRIPT = new Set(["./eslint-plugin"])

/** @param {string} root @param {string} file @returns {string} the file relative to the package, written with `/` on every platform. */
const shown = (root, file) => path.relative(root, file).split(path.sep).join("/")

/**
 * @param {unknown} entry - one `exports` entry, however it is shaped.
 * @returns {string[]} the built JS files it resolves to (`import` and `require`, never `.d.ts`).
 */
export function entryFiles(entry) {
  if (typeof entry === "string") return /\.[cm]?js$/.test(entry) ? [entry] : []
  return Object.entries(entry ?? {}).flatMap(([condition, target]) =>
    condition === "types" || condition.startsWith("types@") ? [] : entryFiles(target),
  )
}

/**
 * @param {string} source - a built file's text.
 * @returns {string[]} every module it imports, by any of the three import forms.
 */
export function specifiers(source) {
  return [
    ...[...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...source.matchAll(/\bimport\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ]
}

/**
 * @param {string} start - a built file.
 * @returns {{ files: Map<string, string>, external: Set<string> }} every file reachable from it through relative
 *   imports, and every bare or node specifier seen on the way.
 */
export function closure(start) {
  const files = new Map()
  const external = new Set()
  // A set, so a file reached again through a cycle is not visited twice.
  const queue = new Set([start])
  for (const file of queue) {
    const source = readFileSync(file).toString()
    files.set(file, source)
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) external.add(spec)
      else if (existsSync(path.resolve(path.dirname(file), spec))) {
        queue.add(path.resolve(path.dirname(file), spec))
      }
    }
  }
  return { files, external }
}

/**
 * @param {string} root - the package's root.
 * @param {{ bin?: string | Record<string, string>, exports: Record<string, unknown> }} pkg
 * @returns {{ problems: string[], clients: number }} what is wrong, and how many client entry files were checked.
 */
export function inspectIsolation(root, pkg) {
  const problems = []
  const resolveEntries = (name) =>
    entryFiles(pkg.exports[name]).map((rel) => ({ name, file: path.join(root, rel) }))
  const binFiles = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {})
  const buildEntries = [
    ...resolveEntries("./build"),
    ...binFiles.map((rel) => ({ name: "bin", file: path.join(root, rel) })),
  ]
  const clientEntries = Object.keys(pkg.exports)
    .filter(
      (name) =>
        name !== "./build" && !name.includes("package.json") && !name.startsWith("./schema"),
    )
    .flatMap(resolveEntries)

  for (const { name, file } of [...buildEntries, ...clientEntries]) {
    if (!existsSync(file)) {
      problems.push(`${name}: ${shown(root, file)} is missing -- build the package first`)
    }
  }
  if (problems.length > 0) return { problems, clients: clientEntries.length }

  const buildReachesCompiler = buildEntries
    .filter((entry) => entry.name === "./build")
    .some(({ file }) =>
      [...closure(file).files.values()].some((source) =>
        source.includes("@typescript/typescript6"),
      ),
    )
  if (!buildReachesCompiler) {
    problems.push(
      "the ./build entry never reaches @typescript/typescript6, so this check proves nothing -- did the loader move?",
    )
  }

  for (const { name, file } of clientEntries) {
    const { files, external } = closure(file)
    for (const marker of COMPILER_MARKERS) {
      const hit = [...files.entries()].find(([, source]) => source.includes(marker))
      if (hit !== undefined) {
        problems.push(
          `${name} (${shown(root, file)}) can reach "${marker}" via ${shown(root, hit[0])} -- the compiler may only be used by the build entry`,
        )
      }
    }
    if (!MAY_IMPORT_TYPESCRIPT.has(name) && external.has("typescript")) {
      problems.push(
        `${name} (${shown(root, file)}) imports "typescript" -- only the build entry may`,
      )
    }
  }
  return { problems, clients: clientEntries.length }
}

/**
 * @param {readonly string[]} _argv
 * @param {string} cwd - the package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {number} the exit code.
 */
export function run(_argv, cwd, io) {
  const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
  const { problems, clients } = inspectIsolation(cwd, pkg)
  if (problems.length > 0) {
    io.err(`compiler-isolation: FAIL\n  ${problems.join("\n  ")}\n`)
    return 1
  }
  io.out(
    `compiler-isolation: OK -- ${String(clients)} client entry file(s) cannot reach the bundled compiler; the build entry does\n`,
  )
  return 0
}
