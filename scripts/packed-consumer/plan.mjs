// What a package's consumers can actually reach, and how to read it when reaching it fails. Source-level
// tests prove the code works; only installing the packed tarball into a clean project and importing each
// entry point proves the published package does. This module is the pure half: which entries to try, and
// whether a failure is the package's fault or only a peer dependency the consumer has not installed.

import { gunzipSync } from "node:zlib"

const SKIPPED_KEYS = new Set(["./package.json"])

/**
 * Calls `visit(key, value)` for every key and value in an export target, depth first. JSON's own traversal
 * does the walking (a fallback array has index keys, a conditions object has names).
 * @param {unknown} target
 * @param {(key: string, value: unknown) => void} visit
 */
function walk(target, visit) {
  JSON.stringify(target, (key, value) => {
    visit(key, value)
    return value
  })
}

/**
 * Whether a condition name appears anywhere in an export target.
 * @param {unknown} target
 * @param {string} condition
 * @returns {boolean}
 */
function hasCondition(target, condition) {
  let found = false
  walk(target, (key) => {
    found = found || key === condition
  })
  return found
}

/**
 * Every file an export target points at, through nested conditions and fallback arrays.
 * @param {unknown} target
 * @returns {string[]}
 */
export function targetFiles(target) {
  const files = []
  walk(target, (_key, value) => {
    if (typeof value === "string") files.push(value)
  })
  return files
}

/**
 * The entry points to try, one per exported subpath. A subpath is imported always; it is also required
 * only when its export map names a `require` condition, because an ESM-only entry is not a CommonJS
 * promise (and a bare string target is not either). Wildcard subpaths and `./package.json` are skipped:
 * a pattern names many files, and the manifest is not code.
 * @param {{ name: string, exports?: unknown, main?: string }} manifest
 * @returns {{ specifier: string, require: boolean, json: boolean }[]} `json` is set when every file the
 *   subpath points at is JSON, which Node can only import with a JSON import attribute.
 */
export function entryPoints(manifest) {
  const { name, exports } = manifest
  if (exports === undefined || exports === null) {
    return manifest.main === undefined
      ? []
      : [{ specifier: name, require: true, json: manifest.main.endsWith(".json") }]
  }
  // A string or array has index keys, an object of conditions has names; only a subpath map has dots.
  const map = Object.keys(exports).some((key) => key.startsWith(".")) ? exports : { ".": exports }
  return Object.entries(map)
    .filter(([key, target]) => !SKIPPED_KEYS.has(key) && !key.includes("*") && target !== null)
    .map(([key, target]) => ({
      specifier: key === "." ? name : `${name}/${key.slice(2)}`,
      require: hasCondition(target, "require"),
      json: targetFiles(target).every((file) => file.endsWith(".json")),
    }))
}

/**
 * Every file the manifest promises is in the tarball: export targets (without patterns) and `bin` files.
 * @param {{ exports?: unknown, main?: string, bin?: string | Record<string, string> }} manifest
 * @returns {string[]} package-relative paths, without a leading `./`, sorted and unique.
 */
export function promisedFiles(manifest) {
  const bins = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {})
  const exported =
    manifest.exports === undefined ? [manifest.main ?? ""] : targetFiles(manifest.exports)
  return [
    ...new Set(
      [...exported, ...bins]
        .filter((file) => file !== "" && !file.includes("*") && !file.endsWith("/"))
        .map((file) => file.replace(/^\.\//, "")),
    ),
  ].sort()
}

/**
 * Files the manifest promises that the tarball does not contain.
 * @param {readonly string[]} promised
 * @param {readonly string[]} packed - the tarball's file paths.
 * @returns {string[]}
 */
export function missingFromTarball(promised, packed) {
  const present = new Set(packed)
  return promised.filter((file) => !present.has(file))
}

/**
 * @param {string} output - what `node` printed when the import failed.
 * @returns {string | undefined} the package the failure says could not be found, if it says so.
 */
export function missingPackage(output) {
  const found = /Cannot find (?:module|package) '([^']+)'/.exec(output)?.[1]
  if (found === undefined) return undefined
  const parts = found.split("/")
  return found.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

/**
 * Decides whether a failed import is the package's own fault. A missing package that the manifest
 * declares as a peer dependency is the consumer's to install (an optional integration, such as an ESLint
 * plugin needing ESLint), so it is skipped and named; anything else is broken.
 * @param {string} output - what `node` printed when the import failed.
 * @param {{ peerDependencies?: Record<string, string>, peerDependenciesMeta?: Record<string, unknown> }} manifest
 * @returns {{ kind: "peer", peer: string } | { kind: "broken", reason: string }}
 */
export function classifyFailure(output, manifest) {
  const missing = missingPackage(output)
  const peers = new Set([
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.peerDependenciesMeta ?? {}),
  ])
  if (peers.has(missing)) return { kind: "peer", peer: missing }
  const lines = output.split("\n").filter((line) => line.trim() !== "")
  const named = lines.find((line) => /Error\b.*:/.test(line))
  return { kind: "broken", reason: (named ?? lines[0] ?? "no output").trim() }
}

const BLOCK = 512

/**
 * The files in an npm tarball and what each holds, read in Node so no external `tar` is needed (the one on a
 * Windows runner can treat `C:\path` as a remote host). Handles the long-name forms npm writes: the ustar `prefix`
 * field and a pax extended header's `path` record.
 * @param {Buffer} gzipped - the contents of the `.tgz`.
 * @returns {{ name: string, content: Buffer }[]} each file's path inside the package, without the leading `package/`,
 *   and its bytes.
 */
export function readTarball(gzipped) {
  const tar = gunzipSync(gzipped)
  const files = []
  let offset = 0
  let extendedPath
  // Bounded by the number of blocks: every entry takes at least one, so a well-formed archive never needs
  // more iterations, and a corrupt one cannot loop forever.
  // Stryker disable next-line EqualityOperator, ArithmeticOperator, AssignmentOperator: equivalent -- the bound is only a guard; the end-of-archive marker, or running out of data, stops a real archive first.
  for (let entry = 0; entry < tar.length / BLOCK; entry += 1) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.length < BLOCK || header.every((byte) => byte === 0)) break
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0[\s\S]*/, "")
    const size = Number.parseInt(field(124, 12), 8)
    const type = String.fromCharCode(header[156])
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size)
    if (type === "x") {
      extendedPath = /(?:^|\n)\d+ path=([^\n]*)/.exec(body.toString("utf8"))?.[1]
    } else if (type === "0" || type === "\0") {
      const prefix = field(345, 155)
      const name = extendedPath ?? (prefix === "" ? field(0, 100) : `${prefix}/${field(0, 100)}`)
      files.push({ name: name.replace(/^package\//, ""), content: body })
      extendedPath = undefined
    }
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK
  }
  return files
}

/**
 * @param {Buffer} gzipped - the contents of the `.tgz`.
 * @returns {string[]} each file's path inside the package, without the leading `package/`.
 */
export function tarballFiles(gzipped) {
  return readTarball(gzipped).map((file) => file.name)
}
