import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  spawnOptions,
  BENCHMARK_PAGE_SCRIPT,
  definesBenchmarkPage,
  prepare,
} from "../scripts/contract-prepare.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-prepare-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const manifest = (scripts?: Record<string, unknown>): void =>
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", scripts }))

describe("definesBenchmarkPage", () => {
  it("is true only for a package.json whose docs:benchmarks script is a string", () => {
    expect(BENCHMARK_PAGE_SCRIPT).toBe("docs:benchmarks")
    expect(definesBenchmarkPage(dir)).toBe(false)
    manifest()
    expect(definesBenchmarkPage(dir)).toBe(false)
    manifest({ build: "tsup" })
    expect(definesBenchmarkPage(dir)).toBe(false)
    manifest({ "docs:benchmarks": 1 })
    expect(definesBenchmarkPage(dir)).toBe(false)
    manifest({ "docs:benchmarks": "node render.mjs" })
    expect(definesBenchmarkPage(dir)).toBe(true)
  })
})

describe("prepare", () => {
  const harness = (status = 0) => {
    const written: string[] = []
    const calls: [string, string[], string][] = []
    return {
      written,
      calls,
      out: { write: (text: string) => written.push(text) },
      spawn: (command: string, args: string[], cwd: string) => {
        calls.push([command, args, cwd])
        return status
      },
    }
  }
  it("does nothing, and says nothing, when the package does not define the script", () => {
    const h = harness()
    manifest({ build: "tsup" })
    prepare({ cwd: dir, out: h.out, spawn: h.spawn })
    expect(h.calls).toEqual([])
    expect(h.written).toEqual([])
  })
  it("builds the page first, saying so, when the package defines the script", () => {
    const h = harness()
    manifest({ "docs:benchmarks": "node render.mjs" })
    prepare({ cwd: dir, out: h.out, spawn: h.spawn })
    expect(h.calls).toEqual([["npm", ["run", "--silent", "docs:benchmarks"], dir]])
    expect(h.written).toEqual([
      "[contract] npm run docs:benchmarks (the benchmark page the docs link to)\n",
    ])
  })
  it("stops the run, with the way out, when the page cannot be built", () => {
    const h = harness(1)
    manifest({ "docs:benchmarks": "node render.mjs" })
    expect(() => {
      prepare({ cwd: dir, out: h.out, spawn: h.spawn })
    }).toThrow(
      "`npm run docs:benchmarks` failed, so the benchmark page the docs link to does not exist. Fix it, or remove the script if this package has no benchmark history.",
    )
  })
  it("runs the real npm script when no seam is given", () => {
    const h = harness()
    manifest({ "docs:benchmarks": "node -e \"require('fs').writeFileSync('built.txt','ok')\"" })
    prepare({ cwd: dir, out: h.out })
    expect(readFileSync(path.join(dir, "built.txt"), "utf8")).toBe("ok")
    manifest({ "docs:benchmarks": 'node -e "process.exit(3)"' })
    expect(() => {
      prepare({ cwd: dir, out: h.out })
    }).toThrow("failed")
  })

  it("runs the command in the repository and lets what it prints reach the person running the contract", () => {
    expect(spawnOptions("/repo")).toEqual({ cwd: "/repo", stdio: "inherit" })
  })
})
