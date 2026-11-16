import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OPTIONAL_CHECKS, optionalChecks } from "../checks/optional.js"
import { quickStartCheck } from "../checks/quick-start.js"
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

describe("QuickStart, the optional check", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "quick-start-optional-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("waits for the tests, because it packs the build they follow", () => {
    expect(OPTIONAL_CHECKS["QuickStart"]?.dependsOn).toEqual(["Tests"])
  })

  it("is turned on by naming it in package.json", () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ "internal-package-contract": { checks: ["QuickStart"] } }),
    )
    const checks = optionalChecks(dir)
    expect(Object.keys(checks)).toEqual(["QuickStart"])
    expect(checks["QuickStart"]?.dependsOn).toEqual(["Tests"])
    expect(checks["QuickStart"]?.run).toEqual(quickStartCheck().run)
  })
})
