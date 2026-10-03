import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  cacheDir,
  cacheTtlMs,
  isTrustedDir,
  isValidEntry,
  readCached,
  writeCached,
} from "../scripts/socket-score-cache.mjs"

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-score-cache-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const data = (over: Record<string, unknown> = {}) => ({
  package: "left-pad",
  scoredVersion: "1.0.0",
  alerts: [{ name: "unmaintained" }],
  ...over,
})

describe("cacheDir() / cacheTtlMs()", () => {
  it("defaults to a per-user directory under the home directory, never a shared temp directory", () => {
    const dir = cacheDir({}) as string
    expect(dir).toBe(path.join(homedir(), ".cache", "ipc-socket-score-cache"))
    expect(dir.startsWith(tmpdir())).toBe(false)
  })

  it("honours an explicit directory and switches off on request", () => {
    expect(cacheDir({ IPC_SOCKET_CACHE_DIR: "/x" })).toBe("/x")
    expect(cacheDir({ IPC_SOCKET_CACHE: "off", IPC_SOCKET_CACHE_DIR: "/x" })).toBeUndefined()
  })

  it("defaults to 24 hours and accepts a positive number of hours", () => {
    expect(cacheTtlMs({})).toBe(24 * 3_600_000)
    expect(cacheTtlMs({ IPC_SOCKET_CACHE_TTL_HOURS: "2" })).toBe(2 * 3_600_000)
    expect(cacheTtlMs({ IPC_SOCKET_CACHE_TTL_HOURS: "-1" })).toBe(24 * 3_600_000)
    expect(cacheTtlMs({ IPC_SOCKET_CACHE_TTL_HOURS: "abc" })).toBe(24 * 3_600_000)
  })
})

describe("isValidEntry()", () => {
  it("accepts a score for exactly the package and version asked about", () => {
    expect(isValidEntry({ savedAt: 1, data: data() }, "left-pad", "1.0.0")).toBe(true)
  })

  it("rejects a score for another package or version, and anything malformed", () => {
    const entry = (over: Record<string, unknown>) => ({ savedAt: 1, data: data(over) })
    expect(isValidEntry(entry({ package: "other" }), "left-pad", "1.0.0")).toBe(false)
    expect(isValidEntry(entry({ scoredVersion: "2.0.0" }), "left-pad", "1.0.0")).toBe(false)
    expect(isValidEntry(entry({ alerts: "none" }), "left-pad", "1.0.0")).toBe(false)
    expect(isValidEntry(entry({ alerts: [1] }), "left-pad", "1.0.0")).toBe(false)
    expect(isValidEntry({ data: data() }, "left-pad", "1.0.0")).toBe(false)
    expect(isValidEntry({ savedAt: 1, data: null }, "left-pad", "1.0.0")).toBe(false)
    expect(isValidEntry({ savedAt: 1, data: 3 }, "left-pad", "1.0.0")).toBe(false)
    expect(isValidEntry(null, "left-pad", "1.0.0")).toBe(false)
    expect(isValidEntry("x", "left-pad", "1.0.0")).toBe(false)
  })
})

describe.skipIf(process.platform === "win32")("isTrustedDir()", () => {
  it("trusts a directory only the current user can write, and nothing else", () => {
    const own = path.join(root, "own")
    mkdirSync(own, { mode: 0o700 })
    expect(isTrustedDir(own)).toBe(true)
    chmodSync(own, 0o777)
    expect(isTrustedDir(own)).toBe(false)
    chmodSync(own, 0o770)
    expect(isTrustedDir(own)).toBe(false)
    expect(isTrustedDir(path.join(root, "missing"))).toBe(false)
    const file = path.join(root, "file")
    writeFileSync(file, "")
    expect(isTrustedDir(file)).toBe(false)
  })
})

describe.skipIf(process.platform === "win32")("readCached() / writeCached()", () => {
  const DAY = 24 * 3_600_000

  it("round-trips a score, and creates the directory private to the user", () => {
    const dir = path.join(root, "cache")
    writeCached(dir, "left-pad", "1.0.0", data(), 1000)
    expect(isTrustedDir(dir)).toBe(true)
    expect(readCached(dir, "left-pad", "1.0.0", DAY, 2000)).toEqual(data())
  })

  it("does not serve a stale entry, or any entry when the cache is switched off", () => {
    const dir = path.join(root, "cache")
    writeCached(dir, "left-pad", "1.0.0", data(), 1000)
    expect(readCached(dir, "left-pad", "1.0.0", DAY, 1000 + DAY + 1)).toBeUndefined()
    expect(readCached(undefined, "left-pad", "1.0.0", DAY, 2000)).toBeUndefined()
    writeCached(undefined, "left-pad", "1.0.0", data(), 1000)
  })

  it("ignores a planted entry that claims to be a clean score for another package", () => {
    const dir = path.join(root, "cache")
    writeCached(dir, "left-pad", "1.0.0", data(), 1000)
    // an entry for left-pad@1.0.0 whose payload describes something else, with no alerts
    writeFileSync(
      path.join(dir, "left-pad@1.0.0.json"),
      JSON.stringify({ savedAt: 1000, data: data({ package: "evil", alerts: [] }) }),
    )
    expect(readCached(dir, "left-pad", "1.0.0", DAY, 2000)).toBeUndefined()
  })

  it("does not read from, or write to, a directory other users can write to", () => {
    const dir = path.join(root, "cache")
    writeCached(dir, "left-pad", "1.0.0", data(), 1000)
    chmodSync(dir, 0o777)
    expect(readCached(dir, "left-pad", "1.0.0", DAY, 2000)).toBeUndefined()
    writeCached(dir, "other", "2.0.0", data({ package: "other", scoredVersion: "2.0.0" }), 1000)
    chmodSync(dir, 0o700)
    expect(readCached(dir, "other", "2.0.0", DAY, 2000)).toBeUndefined()
  })

  it("treats an unreadable or unwritable cache as absent", () => {
    expect(readCached(path.join(root, "nope"), "a", "1", DAY, 1)).toBeUndefined()
    const file = path.join(root, "a-file")
    writeFileSync(file, "")
    expect(() => writeCached(path.join(file, "sub"), "a", "1", data(), 1)).not.toThrow()
  })
})
