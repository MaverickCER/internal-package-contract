import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { scorecardWorkflowCheck } from "../checks/scorecard-workflow.js"
import {
  validateScorecardWorkflow,
  validateScorecardWorkflows,
} from "../scripts/scorecard/validate.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const SHA = "2d1146689b8cda280b9bc96326124645441f03bc"
const GOOD = `name: Scorecard
on:
  schedule:
    - cron: "17 3 * * 1"
  push:
    branches: [main]
permissions: read-all
jobs:
  analysis:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      id-token: write
    steps:
      - uses: ossf/scorecard-action@${SHA} # v2.4.4
        with:
          results_file: results.sarif
          publish_results: true
`

describe("validateScorecardWorkflow", () => {
  it("accepts a pinned, publishing, scheduled workflow", () => {
    expect(validateScorecardWorkflow(GOOD)).toEqual([])
  })
  it("requires the action pinned to a full commit SHA", () => {
    const message = "the scorecard action must be pinned to a full commit SHA."
    expect(validateScorecardWorkflow(GOOD.replace(SHA, "v2.4.4"))).toEqual([message])
    expect(validateScorecardWorkflow(GOOD.replace(SHA, SHA.slice(1)))).toEqual([message])
    expect(validateScorecardWorkflow(GOOD.replace(SHA, `${SHA}0`))).toEqual([message])
    expect(validateScorecardWorkflow(GOOD.replace(SHA, SHA.toUpperCase()))).toEqual([message])
    expect(validateScorecardWorkflow(GOOD.replace(`@${SHA} # v2.4.4`, ""))).toEqual([message])
  })
  it("requires published results", () => {
    const message = "the scorecard action must set `publish_results: true` so the result is public."
    expect(
      validateScorecardWorkflow(GOOD.replace("publish_results: true", "publish_results: false")),
    ).toEqual([message])
    expect(validateScorecardWorkflow(GOOD.replace("publish_results: true\n", ""))).toEqual([
      message,
    ])
  })
  it("requires the OIDC permission and a schedule", () => {
    expect(validateScorecardWorkflow(GOOD.replace("id-token: write", "id-token: read"))).toEqual([
      "the scorecard job needs the `id-token: write` permission to sign its result.",
    ])
    expect(validateScorecardWorkflow(GOOD.replace("schedule:", "pull_request:"))).toEqual([
      "the workflow needs a `schedule:` trigger so the score does not go stale.",
    ])
  })
})

describe("validateScorecardWorkflow -- no use of the action", () => {
  it("reports the pin problem once rather than failing, when no line uses the action", () => {
    expect(
      validateScorecardWorkflow(GOOD.replace("- uses: ossf/scorecard-action", "- run: echo")),
    ).toEqual(["the scorecard action must be pinned to a full commit SHA."])
  })
})

describe("validateScorecardWorkflows", () => {
  it("fails when no workflow runs the action", () => {
    expect(validateScorecardWorkflows([{ name: "ci.yml", text: "name: CI" }])).toEqual([
      "no workflow in .github/workflows runs `ossf/scorecard-action`, so the package publishes no Scorecard result.",
    ])
    expect(validateScorecardWorkflows([])).toHaveLength(1)
  })
  it("names the file each problem is in and ignores other workflows", () => {
    const workflows = [
      { name: "ci.yml", text: "name: CI" },
      { name: "scorecard.yml", text: GOOD.replace("publish_results: true", "") },
    ]
    expect(validateScorecardWorkflows(workflows)).toEqual([
      "scorecard.yml: the scorecard action must set `publish_results: true` so the result is public.",
    ])
    expect(validateScorecardWorkflows([{ name: "scorecard.yml", text: GOOD }])).toEqual([])
  })
})

describe("validateScorecardWorkflow -- line handling", () => {
  it("ignores indentation, a list dash and trailing comments", () => {
    const text = GOOD.replace("      - uses:", "      -   uses:").replace(
      "publish_results: true",
      "publish_results: true   # public",
    )
    expect(validateScorecardWorkflow(text.replace("-   uses:", "- uses:"))).toEqual([])
  })
  it("does not accept a setting that is commented out or only a suffix or prefix of the real one", () => {
    const publish = "the scorecard action must set `publish_results: true` so the result is public."
    expect(
      validateScorecardWorkflow(GOOD.replace("publish_results: true", "# publish_results: true")),
    ).toEqual([publish])
    expect(
      validateScorecardWorkflow(GOOD.replace("publish_results: true", "x_publish_results: true")),
    ).toEqual([publish])
    expect(
      validateScorecardWorkflow(GOOD.replace("publish_results: true", "publish_results: truer")),
    ).toEqual([publish])
    expect(validateScorecardWorkflow(GOOD.replace("id-token: write", "# id-token: write"))).toEqual(
      ["the scorecard job needs the `id-token: write` permission to sign its result."],
    )
    expect(
      validateScorecardWorkflow(GOOD.replace("id-token: write", "my-id-token: write")),
    ).toHaveLength(1)
    expect(validateScorecardWorkflow(GOOD.replace("schedule:", "# schedule:"))).toEqual([
      "the workflow needs a `schedule:` trigger so the score does not go stale.",
    ])
    expect(validateScorecardWorkflow(GOOD.replace("schedule:", "unschedule:"))).toHaveLength(1)
  })
  it("reads the action reference from the line that uses it", () => {
    expect(
      validateScorecardWorkflow(GOOD.replace("      - uses:", "      - name: x\n        uses:")),
    ).toEqual([])
  })
  it("does not count a commented-out use of the action", () => {
    expect(
      validateScorecardWorkflows([{ name: "a.yml", text: GOOD.replace("- uses:", "# - uses:") }]),
    ).toEqual([
      "no workflow in .github/workflows runs `ossf/scorecard-action`, so the package publishes no Scorecard result.",
    ])
  })
})

const judge = (value: unknown) =>
  scorecardWorkflowCheck().policy(makeContext(makeJsonResult(value)))

describe("scorecardWorkflowCheck (policy)", () => {
  it("runs the bundled script and asks for JSON", () => {
    const check = scorecardWorkflowCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-scorecard-workflow\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes a private package, a publishing workflow, and fails on problems", async () => {
    expect(await judge({ ok: true, state: "exempt" })).toEqual({
      outcome: "pass",
      rationale: "ScorecardWorkflow: this package is private, so it publishes no Scorecard.",
    })
    expect(await judge({ ok: true, state: "current" })).toEqual({
      outcome: "pass",
      rationale:
        "ScorecardWorkflow: a workflow publishes the OpenSSF Scorecard result on a schedule.",
    })
    expect(await judge({ ok: true, state: "problem", message: "a\nb" })).toEqual({
      outcome: "fail",
      rationale: "ScorecardWorkflow: a\nb",
    })
  })
  it("fails closed on output that is not the envelope", async () => {
    const result = await scorecardWorkflowCheck().policy(
      makeContext(makeResult({ stdout: "oops" })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe("ScorecardWorkflow: output could not be parsed as JSON.\noops")
  })
})

describe("check-scorecard-workflow (script)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-scorecard-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const script = path.resolve(import.meta.dirname, "../scripts/check-scorecard-workflow.mjs")
  const envelope = () =>
    JSON.parse(spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }).stdout)
  const manifest = (value: unknown) =>
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(value))
  const workflow = (name: string, text: string) => {
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    writeFileSync(path.join(dir, ".github", "workflows", name), text)
  }
  const missing =
    "no workflow in .github/workflows runs `ossf/scorecard-action`, so the package publishes no Scorecard result."

  it("exempts a private package", () => {
    manifest({ private: true })
    expect(envelope()).toEqual({ ok: true, state: "exempt" })
  })
  it("fails a public package with no workflows directory", () => {
    manifest({ name: "x" })
    expect(envelope()).toEqual({ ok: true, state: "problem", message: missing })
  })
  it("treats a missing package.json as public", () => {
    expect(envelope()).toEqual({ ok: true, state: "problem", message: missing })
  })
  it("reads yml and yaml files and skips other files", () => {
    manifest({ name: "x" })
    workflow("notes.txt", GOOD)
    expect(envelope().state).toBe("problem")
    workflow("score.yaml", GOOD)
    expect(envelope()).toEqual({ ok: true, state: "current" })
  })
  it("reports what is wrong with a workflow that cannot publish", () => {
    manifest({ name: "x" })
    workflow("scorecard.yml", GOOD.replace("publish_results: true", ""))
    expect(envelope()).toEqual({
      ok: true,
      state: "problem",
      message:
        "scorecard.yml: the scorecard action must set `publish_results: true` so the result is public.",
    })
  })
})

describe("scorecardWorkflowCheck (policy) -- edges", () => {
  it("names the tool when it did not run to completion", async () => {
    expect(
      await scorecardWorkflowCheck().policy(makeContext(makeResult({ status: "timed_out" }))),
    ).toEqual({
      outcome: "fail",
      rationale: "check-scorecard-workflow did not run to completion (status: timed_out).",
    })
  })
  it("falls back to a generic message when a problem carries none", async () => {
    expect(
      await scorecardWorkflowCheck().policy(
        makeContext(makeJsonResult({ ok: true, state: "problem" })),
      ),
    ).toEqual({
      outcome: "fail",
      rationale: "ScorecardWorkflow: the Scorecard workflow could not be checked.",
    })
  })
})
