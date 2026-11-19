import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { quickStart } from "repo-contract/presets"
import { OPTIONAL_CHECKS, optionalChecks } from "../checks/optional.js"
import { quickStartCheck } from "../checks/quick-start.js"
import { standardChecks } from "../checks/standard.js"
import { RETIRED_CHECKS } from "../scripts/recipes/optional-settings.mjs"
import { COMPLETE_V2, makeContext, makeJsonResult, makeResult, unexcepted } from "./support.js"

const INSTALL = "npm install --save-dev ../tarball/p-1.0.0.tgz"

/** What `repo-contract quick-start --json` prints when the install is the command that failed. */
const failedInstall = (output: string) => ({
  schemaVersion: 1,
  readme: "README.md",
  state: "failed",
  commands: [{ command: INSTALL, exitCode: 1, timedOut: false, durationMs: 900 }],
  output,
})

const NETWORK_RATIONALE = (output: string) =>
  `the quick start could not reach the network, so it was not judged. README.md's quick start failed at command 1, \`${INSTALL}\`: it exited 1. Its last output:\n  ${output}`

describe("quickStartCheck", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "quick-start-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const judge = (report: unknown) =>
    quickStartCheck({ cwd: dir }).policy(makeContext(makeJsonResult(report)))

  it("runs repo-contract's quick-start command on README.md with a five-minute budget", () => {
    const check = quickStartCheck({ cwd: dir })
    expect(check.run).toEqual([
      "repo-contract",
      "quick-start",
      "--json",
      "--readme",
      "README.md",
      "--timeout",
      "300000",
    ])
    expect(check.output).toEqual({ format: "json" })
    expect(check.timeoutMs).toBe(420_000)
  })

  it("passes when every command of the marked block passed against the packed tarball", async () => {
    const report = {
      schemaVersion: 1,
      readme: "README.md",
      state: "passed",
      commands: [
        { command: INSTALL, exitCode: 0, timedOut: false, durationMs: 900 },
        { command: "npx p --help", exitCode: 0, timedOut: false, durationMs: 100 },
      ],
    }
    expect(await judge(report)).toEqual({
      outcome: "pass",
      rationale:
        "QuickStart: README.md's quick start ran 2 command(s) against the packed tarball in an empty project.",
    })
  })

  it("fails a README with no marked block, saying how to mark one", async () => {
    const message =
      "README.md has no marked quick start. Put <!-- quick-start:begin --> on the line before its fenced shell block and <!-- quick-start:end --> on the line after it."
    expect(
      await judge({ schemaVersion: 1, readme: "README.md", state: "no-block", message }),
    ).toEqual({ outcome: "fail", rationale: `QuickStart: ${message}` })
  })

  it("fails a command that broke for a reason other than the network, with its output", async () => {
    const verdict = await judge(failedInstall("npm error code E404"))
    expect(verdict).toEqual({
      outcome: "fail",
      rationale: `QuickStart: README.md's quick start failed at command 1, \`${INSTALL}\`: it exited 1. Its last output:\n  npm error code E404`,
    })
  })

  it("fails when repo-contract's quick-start command is not installed", async () => {
    const verdict = await quickStartCheck({ cwd: dir }).policy(
      makeContext(
        makeResult({
          status: "spawn_error",
          exitCode: null,
          spawnErrorCode: "ENOENT",
          spawnError: "spawn repo-contract ENOENT",
        }),
      ),
    )
    expect(verdict.outcome).toBe("fail")
    expect(verdict.rationale).toMatch(/^QuickStart: /)
    expect(verdict.rationale).toContain("repo-contract")
  })

  it("records a degradation, not a failure, when a command could not reach the network", async () => {
    for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]) {
      const output = `npm error code ${code}`
      expect(await judge(failedInstall(output)), code).toEqual({
        outcome: "warn",
        rationale: unexcepted("environment:QuickStart:network", NETWORK_RATIONALE(output)),
      })
    }
  })

  it("does not read a code inside a longer word as a network error", async () => {
    for (const output of ["XENOTFOUND", "ENOTFOUNDX"]) {
      expect((await judge(failedInstall(output))).outcome, output).toBe("fail")
    }
  })

  it("judges only a failure as a network degradation, never a pass", async () => {
    const report = {
      schemaVersion: 1,
      readme: "docs/ENOTFOUND.md",
      state: "passed",
      commands: [{ command: INSTALL, exitCode: 0, timedOut: false, durationMs: 900 }],
    }
    expect((await judge(report)).outcome).toBe("pass")
  })

  it("reads the environment registry of the working directory when given none", async () => {
    const verdict = await quickStartCheck().policy(
      makeContext(makeJsonResult(failedInstall("npm error code ENOTFOUND"))),
    )
    expect(verdict.outcome).toBe("warn")
    expect(verdict.rationale).toContain("environment:QuickStart:network")
  })

  it("accepts the degradation with a complete record in the package's environment registry", async () => {
    mkdirSync(path.join(dir, ".repo-contract", "exceptions"), { recursive: true })
    writeFileSync(
      path.join(dir, ".repo-contract", "exceptions", "environment.json"),
      JSON.stringify({
        exceptions: [
          {
            id: "environment:QuickStart:network",
            version: 2,
            justification: "This runner has no route to the npm registry.",
            check: "QuickStart",
            code: "network",
            ...COMPLETE_V2,
          },
        ],
      }),
    )
    const verdict = await judge(failedInstall("npm error code ENOTFOUND"))
    expect(verdict.outcome).toBe("warn")
    expect(verdict.rationale).toMatch(
      /^Not evaluated \(accepted by environment:QuickStart:network\)/,
    )
  })
})

describe("quickStartCheck around another QuickStart check", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "quick-start-wrap-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const around = (verdict: PolicyResult): CheckDefinitionConfig => ({
    ...quickStart(),
    policy: () => verdict,
  })

  it("keeps the given check's command and judges with its policy", async () => {
    const check = quickStartCheck({
      cwd: dir,
      check: around({ outcome: "pass", rationale: "fine." }),
    })
    expect(check.run).toEqual(quickStart().run)
    expect(await check.policy(makeContext(makeResult()))).toEqual({
      outcome: "pass",
      rationale: "QuickStart: fine.",
    })
  })

  it("still reads a network failure of the given check as a degradation", async () => {
    const failed = { outcome: "fail" as const, rationale: "it exited 1. npm error code ENOTFOUND" }
    const verdict = await quickStartCheck({ cwd: dir, check: around(failed) }).policy(
      makeContext(makeResult()),
    )
    expect(verdict.rationale).toContain("environment:QuickStart:network")
  })
})

describe("QuickStart in the standard", () => {
  // Built inside each test: mutation testing credits a test only with the code that runs during it.
  let checks: Record<string, CheckDefinitionConfig & { dependsOn?: readonly string[] }>
  beforeEach(() => {
    checks = standardChecks()
  })

  it("runs the tier's QuickStart, after the tests and before Mutation", () => {
    const ids = Object.keys(checks)
    expect(ids).toContain("QuickStart")
    expect(ids.indexOf("QuickStart")).toBeLessThan(ids.indexOf("Mutation"))
    expect(checks["QuickStart"]?.dependsOn).toEqual(["Tests"])
    expect(checks["QuickStart"]?.run).toEqual(quickStart().run)
  })

  it("passes as not applicable on a private package, whatever the quick start did", async () => {
    // This repository's own package.json sets "private": true, and the tier reads the working directory's.
    const verdict = await checks["QuickStart"]?.policy(
      makeContext(makeJsonResult(failedInstall("npm error code E404"))),
    )
    expect(verdict?.outcome).toBe("pass")
    expect(verdict?.rationale).toContain("QuickStart is not applicable")
  })
})

describe("QuickStart, no longer optional", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "quick-start-optional-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("is not an optional check", () => {
    expect(OPTIONAL_CHECKS).not.toHaveProperty("QuickStart")
  })

  it("ignores a package.json that still names it, instead of adding it twice or throwing", () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ "internal-package-contract": { checks: ["QuickStart", "Sbom"] } }),
    )
    const said: string[] = []
    expect(Object.keys(optionalChecks(dir, (line) => said.push(line)))).toEqual(["Sbom"])
    expect(said).toEqual([`${RETIRED_CHECKS["QuickStart"] ?? ""}\n`])
  })

  it("says why it ignores the entry, on stderr by default, and says nothing without one", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    try {
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ "internal-package-contract": { checks: ["QuickStart"] } }),
      )
      expect(optionalChecks(dir)).toEqual({})
      expect(write.mock.calls).toEqual([[`${RETIRED_CHECKS["QuickStart"] ?? ""}\n`]])
      write.mockClear()
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ "internal-package-contract": { checks: ["Sbom"] } }),
      )
      optionalChecks(dir)
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
    }
  })

  it("still throws on a name that never was a check", () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ "internal-package-contract": { checks: ["QuickStrat"] } }),
    )
    expect(() => optionalChecks(dir)).toThrow("QuickStrat")
  })
})
