import { spawnSync } from "node:child_process"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { helpText, wantsHelp } from "../scripts/contract-help.mjs"

const bin = path.resolve(import.meta.dirname, "../bin/contract.mjs")

describe("wantsHelp", () => {
  it("is true for --help or -h anywhere, and for nothing else", () => {
    expect(wantsHelp(["--help"])).toBe(true)
    expect(wantsHelp(["--checks", "a", "-h"])).toBe(true)
    expect(wantsHelp(["--checks", "a"])).toBe(false)
    expect(wantsHelp([])).toBe(false)
  })
})

describe("helpText", () => {
  it("documents every subcommand and flag the dispatcher accepts", () => {
    const text = helpText()
    for (const word of [
      "init",
      "exceptions",
      "sync-benchmark-guides",
      "update-baseline",
      "install-hooks",
      "site",
      "sync",
      "--checks",
      "--skip",
      "--strict",
      "--no-strict",
      "--help",
    ]) {
      expect(text).toContain(word)
    }
    expect(text.startsWith("Usage: internal-package-contract")).toBe(true)
    expect(text.endsWith("\n")).toBe(true)
  })
})

describe("bin/contract.mjs --help", () => {
  it("prints the usage and exits 0 without running any check, from any directory", () => {
    const result = spawnSync(process.execPath, [bin, "--help"], {
      cwd: path.dirname(bin),
      encoding: "utf8",
      timeout: 20_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(helpText())
    expect(result.stderr).toBe("")
  })
  it("answers -h after a subcommand too, without running the subcommand", () => {
    const result = spawnSync(process.execPath, [bin, "init", "-h"], {
      cwd: path.dirname(bin),
      encoding: "utf8",
      timeout: 20_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(helpText())
  })
})
