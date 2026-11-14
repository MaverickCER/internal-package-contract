// On-disk cache for `socket package score` results (socket-package-score.mjs).
//
// Socket scores a published version, so the answer depends only on `<package>@<version>` and Socket's own slowly
// moving database, not on the branch, the lockfile or the pull request. One entry per scored version therefore
// serves every run and the hooks until it expires, and a scan costs quota only for a new version. Only a successful
// score is cached: a failure (auth, rate limit, network) is retried, never replayed.
//
// `IPC_SOCKET_CACHE_DIR` relocates the cache, `IPC_SOCKET_CACHE_TTL_HOURS` changes the lifetime, and
// `IPC_SOCKET_CACHE=off` bypasses it. CI does not keep the cache between runs: a cache written by a workflow that
// ran pull-request code could be poisoned.
//
// The cache is trusted input: an entry with `alerts: []` makes the check pass. It therefore lives in a directory
// only the current user can write (by default under `~/.cache`, created with mode 0700, never a shared temp
// directory). A directory owned by someone else or writable by others is not read or written, and an entry is used
// only when it is shaped like a score for exactly the package and version asked about.

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const DEFAULT_TTL_HOURS = 24

/** @param {Record<string, string | undefined>} env @returns {string | undefined} the cache directory, or undefined when disabled. */
export function cacheDir(env) {
  if (env["IPC_SOCKET_CACHE"] === "off") return undefined
  return env["IPC_SOCKET_CACHE_DIR"] || path.join(homedir(), ".cache", "ipc-socket-score-cache")
}

/** @param {Record<string, string | undefined>} env @returns {number} the entry lifetime in milliseconds. */
export function cacheTtlMs(env) {
  const hours = Number(env["IPC_SOCKET_CACHE_TTL_HOURS"])
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) * 3_600_000
}

/**
 * Whether `dir` may be trusted as a cache: it must be a directory owned by the current user that no
 * one else can write to. (Windows has no POSIX ownership; there the per-user home is the boundary.)
 * @param {string} dir
 * @returns {boolean}
 */
export function isTrustedDir(dir) {
  try {
    const stats = statSync(dir)
    if (!stats.isDirectory()) return false
    if (process.platform === "win32" || typeof process.getuid !== "function") return true
    return stats.uid === process.getuid() && (stats.mode & 0o022) === 0
  } catch {
    return false
  }
}

/**
 * Whether a parsed cache entry is a well-formed score for exactly `name`@`version`.
 * @param {unknown} entry
 * @param {string} name
 * @param {string} version
 * @returns {boolean}
 */
export function isValidEntry(entry, name, version) {
  const data = entry?.data
  if (!data) return false
  return (
    typeof entry.savedAt === "number" &&
    data.package === name &&
    data.scoredVersion === version &&
    Array.isArray(data.alerts) &&
    data.alerts.every((alert) => typeof alert === "object" && alert !== null)
  )
}

function entryPath(dir, name, version) {
  return path.join(dir, `${`${name}@${version}`.replace(/[^A-Za-z0-9._@-]/g, "_")}.json`)
}

/**
 * @param {string | undefined} dir - the cache directory (undefined disables the cache).
 * @param {string} name - package name.
 * @param {string} version - the version Socket would score.
 * @param {number} ttlMs - the maximum age of a usable entry.
 * @param {number} now - the current time in milliseconds.
 * @returns {object | undefined} the cached `data` payload, or undefined when absent, stale or unreadable.
 */
export function readCached(dir, name, version, ttlMs, now) {
  // No directory is never trusted: `statSync(undefined)` throws, which `isTrustedDir` reports as untrusted.
  if (!isTrustedDir(dir)) return undefined
  try {
    const entry = JSON.parse(readFileSync(entryPath(dir, name, version)).toString())
    return isValidEntry(entry, name, version) && now - entry.savedAt <= ttlMs
      ? entry.data
      : undefined
  } catch {
    // Unreadable, or not JSON: treated as absent, below.
  }
  return undefined
}

/** Stores one successful score; a write failure is ignored (the cache is an optimization only). */
export function writeCached(dir, name, version, data, now) {
  // Stryker disable next-line ConditionalExpression: with no directory `mkdirSync` throws and the catch below swallows it, so this guard only skips that
  if (dir === undefined) return
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (!isTrustedDir(dir)) return
    const file = entryPath(dir, name, version)
    writeFileSync(`${file}.tmp`, JSON.stringify({ savedAt: now, data }))
    renameSync(`${file}.tmp`, file)
  } catch {
    // Read-only or full disk: the next run scans again.
  }
}
