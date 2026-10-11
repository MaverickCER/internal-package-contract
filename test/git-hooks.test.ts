import { describe, expect, it } from "vitest"
import { gitHooksCheck } from "../checks/git-hooks.js"
import { hooksStatus, isCi } from "../scripts/git-hooks.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const real = (p: string) => p.replace(/^\/link/, "/real")
const base = {
  ci: false,
  inRepo: true,
  configured: "/link/hooks",
  bundled: "/real/hooks",
  realpath: real,
}

describe("isCi", () => {
  it("is true for a truthy CI variable or GitHub Actions, and false otherwise", () => {
    expect(isCi({ CI: "true" })).toBe(true)
    expect(isCi({ CI: "1" })).toBe(true)
    expect(isCi({ GITHUB_ACTIONS: "true" })).toBe(true)
    expect(isCi({})).toBe(false)
    for (const off of ["", "false", "0"]) expect(isCi({ CI: off })).toBe(false)
  })
})

describe("hooksStatus", () => {
  it("is not applicable in CI, where hooks are not what gates a change", () => {
    expect(hooksStatus({ ...base, ci: true, configured: undefined })).toBe("ci")
  })
  it("is not applicable outside a git repository", () => {
    expect(hooksStatus({ ...base, inRepo: false })).toBe("not-a-repo")
  })
  it("is installed when core.hooksPath resolves to the bundled hooks, through a symlink or not", () => {
    expect(hooksStatus(base)).toBe("installed")
    expect(hooksStatus({ ...base, configured: "/real/hooks" })).toBe("installed")
  })
  it("is missing when core.hooksPath is unset, empty, or points somewhere else", () => {
    expect(hooksStatus({ ...base, configured: undefined })).toBe("missing")
    expect(hooksStatus({ ...base, configured: "" })).toBe("missing")
    expect(hooksStatus({ ...base, configured: "/home/me/.git-global-hooks" })).toBe("missing")
  })
  it("does not resolve a path that was never configured, so an unset or empty setting is never taken for the bundled hooks", () => {
    const everythingIsBundled = () => "/real/hooks"
    expect(hooksStatus({ ...base, configured: undefined, realpath: everythingIsBundled })).toBe(
      "missing",
    )
    expect(hooksStatus({ ...base, configured: "", realpath: everythingIsBundled })).toBe("missing")
    expect(hooksStatus({ ...base, configured: "/anything", realpath: everythingIsBundled })).toBe(
      "installed",
    )
  })
  it("is missing when the configured path cannot be resolved", () => {
    const failing = () => {
      throw new Error("ENOENT")
    }
    expect(hooksStatus({ ...base, realpath: failing })).toBe("missing")
  })
})

describe("gitHooksCheck (policy)", () => {
  const judge = (state: string) =>
    gitHooksCheck().policy(makeContext(makeJsonResult({ ok: true, state })))
  it("runs the bundled script and asks for JSON", () => {
    const check = gitHooksCheck()
    const run = check.run as readonly string[]
    expect(run[0]).toBe("node")
    expect(run[1]).toMatch(/scripts[\\/]check-git-hooks\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes when the hooks are installed", async () => {
    expect(await judge("installed")).toEqual({
      outcome: "pass",
      rationale: "GitHooks: git is using the bundled internal-package-contract hooks.",
    })
  })
  it("passes, saying why, where hooks do not apply", async () => {
    expect((await judge("ci")).outcome).toBe("pass")
    expect((await judge("not-a-repo")).outcome).toBe("pass")
    expect((await judge("ci")).rationale).toBe(
      "GitHooks: not checked in CI, where this contract is the gate.",
    )
    expect((await judge("not-a-repo")).rationale).toBe("GitHooks: not a git repository.")
  })
  it("warns, with the one command that fixes it, when they are missing", async () => {
    const result = await judge("missing")
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toBe(
      "GitHooks: the bundled hooks are not installed, so commits and pushes are not checked locally and CI will be the first to find a failure. Run `npx internal-package-contract install-hooks` once in this clone.",
    )
  })
  it("names check-git-hooks when the script did not run to completion", async () => {
    const result = await gitHooksCheck().policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "check-git-hooks did not run to completion (status: timed_out).",
    })
  })
  it("fails closed on output that is not the envelope", async () => {
    const result = await gitHooksCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe("GitHooks: output could not be parsed as JSON.\noops")
  })
})
