import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { githubActions } from "../checks/github-actions.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-gha-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe("githubActions", () => {
  it("passes with no .github/workflows directory -- nothing to lint", async () => {
    const result = await githubActions.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "GitHub Actions: no .github/workflows/ directory to lint.",
    })
  })

  it("fails, naming the tool, when actionlint terminated abnormally", async () => {
    mkdirSync(path.join(cwd, ".github/workflows"), { recursive: true })
    const result = await githubActions.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("actionlint did not run to completion")
  })

  it("passes when actionlint reports 0 issues (empty array)", async () => {
    mkdirSync(path.join(cwd, ".github/workflows"), { recursive: true })
    const result = await githubActions.policy(makeContext(makeJsonResult([])))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "GitHub Actions: actionlint reported 0 issues.",
    })
  })

  it("passes when actionlint exits 0 with unparseable/empty output", async () => {
    mkdirSync(path.join(cwd, ".github/workflows"), { recursive: true })
    const result = await githubActions.policy(makeContext(makeResult({ exitCode: 0 })))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "GitHub Actions: actionlint reported 0 issues.",
    })
  })

  it("fails, listing each finding with the exact heading and format, when actionlint reports issues", async () => {
    mkdirSync(path.join(cwd, ".github/workflows"), { recursive: true })
    const result = await githubActions.policy(
      makeContext(
        makeJsonResult([
          { message: "bad syntax", filepath: "ci.yml", line: 3, column: 1, kind: "syntax-check" },
        ]),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "GitHub Actions: actionlint reported 1 issue(s):",
        "- ci.yml:3:1 [syntax-check] bad syntax",
      ].join("\n"),
    })
  })

  it("omits the [kind] bracket entirely when a finding has no kind", async () => {
    mkdirSync(path.join(cwd, ".github/workflows"), { recursive: true })
    const result = await githubActions.policy(
      makeContext(
        makeJsonResult([{ message: "bad syntax", filepath: "ci.yml", line: 3, column: 1 }]),
      ),
    )
    expect(result.rationale).toContain("- ci.yml:3:1 bad syntax")
    expect(result.rationale).not.toContain("[")
  })

  it("fails with the exact stock message and no tail when there is no output at all", async () => {
    mkdirSync(path.join(cwd, ".github/workflows"), { recursive: true })
    const result = await githubActions.policy(makeContext(makeResult({ exitCode: 1 })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "GitHub Actions: actionlint output could not be parsed as JSON.",
    })
  })

  it("fails, appending printed output, when output could not be parsed as JSON and exit code is non-zero", async () => {
    mkdirSync(path.join(cwd, ".github/workflows"), { recursive: true })
    const result = await githubActions.policy(
      makeContext(makeResult({ exitCode: 1, stderr: "raw actionlint output" })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "GitHub Actions: actionlint output could not be parsed as JSON.\nraw actionlint output",
    })
  })
})
