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
    expect(run[6]).toContain("secretlintignore")
    expect(run[8]).toContain("secretlint.config.json")
    expect(run).toEqual([
      "secretlint",
      "--format",
      "json",
      "--output",
      "reports/secretlint.json",
      "--secretlintignore",
      run[6],
      "--secretlintrc",
      run[8],
      "**/*",
    ])
  })

  it("wires run exactly, omitting --secretlintrc entirely, when the consumer has their own config", () => {
    writeFileSync(path.join(cwd, ".secretlintrc.json"), "{}")
    const check = securitySecrets()
    const run = check.run as string[]
    expect(run[6]).toContain("secretlintignore")
    expect(run).toEqual([
      "secretlint",
      "--format",
      "json",
      "--output",
      "reports/secretlint.json",
      "--secretlintignore",
      run[6],
      "**/*",
    ])
  })

  it("omits the trailing positional entirely when the underlying preset's own run has none (last element falsy)", () => {
    const original = securitySecretsPreset.run
    ;(securitySecretsPreset as { run: string[] }).run = []
    try {
      const check = securitySecrets()
      const run = check.run as string[]
      expect(run).toEqual(["--secretlintignore", run[1], "--secretlintrc", run[3]])
    } finally {
      ;(securitySecretsPreset as { run: string[] }).run = original
    }
  })

  it("preserves the underlying secretlint preset's base command and policy", () => {
    const check = securitySecrets()
    const run = check.run as string[]
    expect(run[0]).toBe("secretlint")
    expect(typeof check.policy).toBe("function")
  })
})
