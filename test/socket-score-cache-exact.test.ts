import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cacheTtlMs,
  isTrustedDir,
  isValidEntry,
  readCached,
  writeCached,
} from "../scripts/socket-score-cache.mjs"

const posixOnly = it.skipIf(process.platform === "win32")
let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-score-cache-exact-"))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

const score = (over: Record<string, unknown> = {}) => ({
  package: "left-pad",
  scoredVersion: "1.0.0",
  alerts: [{ name: "unmaintained" }],
  ...over,
})
const entry = (data: unknown, savedAt: unknown = 1) => ({ savedAt, data })

describe("cacheTtlMs()", () => {
  it("uses the hours given when they are above zero, and 24 otherwise", () => {
    const day = 24 * 3_600_000
    expect(cacheTtlMs({ IPC_SOCKET_CACHE_TTL_HOURS: "0" })).toBe(day)
    expect(cacheTtlMs({ IPC_SOCKET_CACHE_TTL_HOURS: "0.5" })).toBe(1_800_000)
    expect(cacheTtlMs({ IPC_SOCKET_CACHE_TTL_HOURS: "" })).toBe(day)
    expect(cacheTtlMs({ IPC_SOCKET_CACHE_TTL_HOURS: "Infinity" })).toBe(day)
    expect(cacheTtlMs({ IPC_SOCKET_CACHE_TTL_HOURS: "1" })).toBe(3_600_000)
  })
})

describe("isTrustedDir()", () => {
  it("trusts a directory only its owner can write", () => {
    const dir = path.join(root, "d")
    mkdirSync(dir, { mode: 0o700 })
    expect(isTrustedDir(dir)).toBe(true)
    chmodSync(dir, 0o755)
    expect(isTrustedDir(dir)).toBe(true)
  })

  posixOnly(
    "distrusts one that group or others can write, and one that is not a directory or does not exist",
    () => {
      const dir = path.join(root, "d")
      mkdirSync(dir)
      for (const mode of [0o775, 0o757, 0o777, 0o770, 0o707]) {
        chmodSync(dir, mode)
        expect(isTrustedDir(dir), mode.toString(8)).toBe(false)
      }
      const file = path.join(root, "f")
      writeFileSync(file, "x")
      expect(isTrustedDir(file)).toBe(false)
      expect(isTrustedDir(path.join(root, "missing"))).toBe(false)
    },
  )

  posixOnly("distrusts a directory owned by someone else", () => {
    const dir = path.join(root, "d")
    mkdirSync(dir, { mode: 0o700 })
    vi.spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 1)
    expect(isTrustedDir(dir)).toBe(false)
  })

  posixOnly(
    "trusts any directory on a platform with no POSIX ownership, or when there is no uid to compare",
    () => {
      const dir = path.join(root, "d")
      mkdirSync(dir)
      chmodSync(dir, 0o777)
      expect(isTrustedDir(dir)).toBe(false)
      const platform = Object.getOwnPropertyDescriptor(process, "platform")
      Object.defineProperty(process, "platform", { value: "win32" })
      try {
        expect(isTrustedDir(dir)).toBe(true)
      } finally {
        if (platform) Object.defineProperty(process, "platform", platform)
      }
      const original = Object.getOwnPropertyDescriptor(process, "getuid")
      Object.defineProperty(process, "getuid", { value: undefined, configurable: true })
      try {
        expect(isTrustedDir(dir)).toBe(true)
      } finally {
        if (original) Object.defineProperty(process, "getuid", original)
      }
    },
  )
})

describe("isValidEntry() shapes", () => {
  const ok = (value: unknown) => isValidEntry(value, "left-pad", "1.0.0")

  it("accepts a well-formed entry, and an empty list of alerts", () => {
    expect(ok(entry(score()))).toBe(true)
    expect(ok(entry(score({ alerts: [] })))).toBe(true)
    expect(ok(entry(score({ alerts: [{}, { a: 1 }] })))).toBe(true)
  })

  it("rejects anything that is not an object with an object payload", () => {
    for (const value of [
      null,
      undefined,
      3,
      "x",
      true,
      [],
      {},
      { data: null },
      { data: 3 },
      { data: "x" },
      { data: undefined },
    ])
      expect(ok(value), String(value)).toBe(false)
  })

  it("needs a numeric savedAt, and every alert to be an object", () => {
    expect(ok(entry(score(), "1"))).toBe(false)
    expect(ok({ data: score() })).toBe(false)
    expect(ok(entry(score({ alerts: [{}, 1] })))).toBe(false)
    expect(ok(entry(score({ alerts: [1, {}] })))).toBe(false)
    expect(ok(entry(score({ alerts: [null] })))).toBe(false)
    expect(ok(entry(score({ alerts: ["x"] })))).toBe(false)
    expect(ok(entry(score({ alerts: undefined })))).toBe(false)
    expect(ok(entry(score({ package: undefined })))).toBe(false)
  })
})

describe("readCached() and writeCached()", () => {
  const dir = () => path.join(root, "cache")
  const trusted = () => {
    mkdirSync(dir(), { mode: 0o700 })
    return dir()
  }

  it("round-trips a score", () => {
    writeCached(dir(), "left-pad", "1.0.0", score(), 1000)
    expect(readCached(dir(), "left-pad", "1.0.0", 5000, 2000)).toEqual(score())
  })

  posixOnly("creates the directory, nested, readable only by its owner", () => {
    const nested = path.join(root, "a", "b", "cache")
    writeCached(nested, "left-pad", "1.0.0", score(), 1)
    expect(readdirSync(nested)).toEqual(["left-pad@1.0.0.json"])
    expect(statSync(nested).mode & 0o777).toBe(0o700)
  })

  it("writes the entry as JSON with its time, leaving no temporary file", () => {
    writeCached(trusted(), "left-pad", "1.0.0", score(), 1234)
    expect(readdirSync(dir())).toEqual(["left-pad@1.0.0.json"])
    expect(JSON.parse(readFileSync(path.join(dir(), "left-pad@1.0.0.json"), "utf8"))).toEqual({
      savedAt: 1234,
      data: score(),
    })
  })

  it("names the file for the package and version, replacing anything unsafe in it", () => {
    writeCached(
      trusted(),
      "@scope/pkg",
      "1.0.0-beta+x",
      score({ package: "@scope/pkg", scoredVersion: "1.0.0-beta+x" }),
      1,
    )
    expect(readdirSync(dir())).toEqual(["@scope_pkg@1.0.0-beta_x.json"])
    writeCached(dir(), "a b", "1", score({ package: "a b", scoredVersion: "1" }), 1)
    expect(readdirSync(dir()).sort()).toEqual(["@scope_pkg@1.0.0-beta_x.json", "a_b@1.json"])
  })

  it("treats an entry as fresh up to and including its lifetime, and stale after", () => {
    writeCached(trusted(), "left-pad", "1.0.0", score(), 1000)
    expect(readCached(dir(), "left-pad", "1.0.0", 500, 1500)).toEqual(score())
    expect(readCached(dir(), "left-pad", "1.0.0", 500, 1501)).toBeUndefined()
    expect(readCached(dir(), "left-pad", "1.0.0", 500, 1499)).toEqual(score())
    expect(readCached(dir(), "left-pad", "1.0.0", 500, 400)).toEqual(score())
  })

  it("is absent for an unknown package or version, a file that is not JSON, or a score for something else", () => {
    writeCached(trusted(), "left-pad", "1.0.0", score(), 1000)
    expect(readCached(dir(), "left-pad", "2.0.0", 5000, 1000)).toBeUndefined()
    expect(readCached(dir(), "other", "1.0.0", 5000, 1000)).toBeUndefined()
    writeFileSync(path.join(dir(), "broken@1.json"), "{ nope")
    expect(readCached(dir(), "broken", "1", 5000, 1000)).toBeUndefined()
    writeFileSync(
      path.join(dir(), "wrong@1.json"),
      JSON.stringify(entry(score({ package: "someone-else" }), 1000)),
    )
    expect(readCached(dir(), "wrong", "1", 5000, 1000)).toBeUndefined()
  })

  posixOnly("never reads from an untrusted directory, or when there is none", () => {
    writeCached(trusted(), "left-pad", "1.0.0", score(), 1000)
    chmodSync(dir(), 0o777)
    expect(readCached(dir(), "left-pad", "1.0.0", 5000, 1000)).toBeUndefined()
    expect(readCached(undefined, "left-pad", "1.0.0", 5000, 1000)).toBeUndefined()
  })

  posixOnly(
    "does not write into an untrusted directory, or when there is none, and never throws",
    () => {
      mkdirSync(dir(), { mode: 0o700 })
      chmodSync(dir(), 0o777)
      writeCached(dir(), "left-pad", "1.0.0", score(), 1)
      expect(readdirSync(dir())).toEqual([])
      expect(() => writeCached(undefined, "left-pad", "1.0.0", score(), 1)).not.toThrow()
      const blocker = path.join(root, "file")
      writeFileSync(blocker, "x")
      expect(() =>
        writeCached(path.join(blocker, "inside"), "left-pad", "1.0.0", score(), 1),
      ).not.toThrow()
    },
  )
})
