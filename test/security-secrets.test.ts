import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { securitySecrets as securitySecretsPreset } from "repo-contract/presets"
import { securitySecrets } from "../checks/security-secrets.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-security-secrets-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe("securitySecrets", () => {
  it("wires run exactly: preset head, bundled ignore, bundled rc, trailing positional, when the consumer has no config", () => {
    const check = securitySecrets()
    const run = check.run as string[]
    expect(run[0]).toBe("node")
    expect(run[1]).toContain("run-secretlint.mjs")
    expect(run[8]).toContain("secretlintignore")
    expect(run[10]).toContain("secretlint.config.json")
    expect(run).toEqual([
      "node",
      run[1],
      "secretlint",
      "--format",
      "json",
      "--output",
      "reports/secretlint.json",
      "--secretlintignore",
      run[8],
      "--secretlintrc",
      run[10],
      "**/*",
    ])
  })

  it("wires run exactly, omitting --secretlintrc entirely, when the consumer has their own config", () => {
    writeFileSync(path.join(cwd, ".secretlintrc.json"), "{}")
    const check = securitySecrets()
    const run = check.run as string[]
    expect(run[8]).toContain("secretlintignore")
    expect(run).toEqual([
      "node",
      run[1],
      "secretlint",
      "--format",
      "json",
      "--output",
      "reports/secretlint.json",
      "--secretlintignore",
      run[8],
      "**/*",
    ])
  })

  it("omits the trailing positional entirely when the underlying preset's own run has none (last element falsy)", () => {
    const original = securitySecretsPreset.run
    ;(securitySecretsPreset as { run: string | readonly string[] }).run = []
    try {
      const check = securitySecrets()
      const run = check.run as string[]
      expect(run).toEqual(["node", run[1], "--secretlintignore", run[3], "--secretlintrc", run[5]])
    } finally {
      ;(securitySecretsPreset as { run: string | readonly string[] }).run = original
    }
  })

  it("preserves the underlying secretlint preset's base command and policy", () => {
    const check = securitySecrets()
    const run = check.run as string[]
    expect(run[2]).toBe("secretlint")
    expect(typeof check.policy).toBe("function")
  })
})
