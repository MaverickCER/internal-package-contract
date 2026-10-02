// On-disk cache for `socket package score` results (see socket-package-score.mjs).
//
// Socket scores a PUBLISHED version, so the answer depends only on `<package>@<version>` (plus
// Socket's own database, which moves slowly) -- not on the branch, the lockfile or which pull
// request asks. One entry per scored version therefore serves every run, every pull request and
// the pre-push hook for a day, and a scan costs quota only when a version is genuinely new.
//
// Only successful scores are cached: a failure (auth, rate limit, network) must be retried, never
// replayed. Set `IPC_SOCKET_CACHE_DIR` to relocate the cache (CI points it at a directory the
// workflow caches between runs), `IPC_SOCKET_CACHE_TTL_HOURS` to change the 24 h lifetime, or
// `IPC_SOCKET_CACHE=off` to bypass it.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const DEFAULT_TTL_HOURS = 24

/** @param {Record<string, string | undefined>} env @returns {string | undefined} the cache directory, or undefined when disabled. */
export function cacheDir(env) {
  if (env["IPC_SOCKET_CACHE"] === "off") return undefined
  return env["IPC_SOCKET_CACHE_DIR"] || path.join(tmpdir(), "ipc-socket-score-cache")
}

/** @param {Record<string, string | undefined>} env @returns {number} the entry lifetime in milliseconds. */
export function cacheTtlMs(env) {
  const hours = Number(env["IPC_SOCKET_CACHE_TTL_HOURS"])
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) * 3_600_000
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
  if (dir === undefined) return undefined
  try {
    const entry = JSON.parse(readFileSync(entryPath(dir, name, version), "utf8"))
    return typeof entry.savedAt === "number" && now - entry.savedAt <= ttlMs
      ? entry.data
      : undefined
  } catch {
    return undefined
  }
}

/** Stores one successful score; a write failure is ignored (the cache is an optimization only). */
export function writeCached(dir, name, version, data, now) {
  if (dir === undefined) return
  try {
    mkdirSync(dir, { recursive: true })
    const file = entryPath(dir, name, version)
    writeFileSync(`${file}.tmp`, JSON.stringify({ savedAt: now, data }), "utf8")
    renameSync(`${file}.tmp`, file)
  } catch {
    // Read-only or full disk: the next run simply scans again.
  }
}
