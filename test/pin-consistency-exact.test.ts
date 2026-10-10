import { describe, expect, it } from "vitest"
import { pinConsistency } from "../checks/pin-consistency.js"
import { checkPins, devDependencyRef, workflowPins } from "../scripts/pin-consistency.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const A = "a".repeat(40)
const B = "b".repeat(40)
const WF = "MaverickCER/internal-package-contract/.github/workflows"
const pkg = (spec: string) =>
  JSON.stringify({ devDependencies: { "internal-package-contract": spec } })
const lock = (sha: string) =>
  JSON.stringify({
    packages: {
      "node_modules/internal-package-contract": {
        resolved: `git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${sha}`,
      },
    },
  })
const wf = (ref: string, tail: string) => [
  { file: "w.yml", text: `x:\n    uses: ${WF}/release.yml@${ref}${tail}\n` },
]

describe("devDependencyRef (exact)", () => {
  it("reads only a github: dependency, anchored at the start", () => {
    expect(devDependencyRef(pkg("github:MaverickCER/internal-package-contract#v1.2.3"))).toBe(
      "v1.2.3",
    )
    expect(devDependencyRef(pkg("npm:github:x/y#v1"))).toBeUndefined()
  })
  it("is undefined when the manifest has no devDependencies at all", () => {
    expect(devDependencyRef("{}")).toBeUndefined()
  })
})

describe("workflowPins (exact)", () => {
  it("trims whitespace and a carriage return from the comment", () => {
    expect(workflowPins(`uses: ${WF}/r.yml@${A} #   v0.10.0  \r\n`)[0]?.comment).toBe("v0.10.0")
  })
})

describe("checkPins (exact messages)", () => {
  it("compares a package that has a devDependency but no workflows", () => {
    expect(
      checkPins({
        packageJson: pkg("github:o/internal-package-contract#v1"),
        lockfile: undefined,
        workflows: [],
      }),
    ).toEqual({
      applies: true,
      problems: [
        "package-lock.json: no commit is recorded for internal-package-contract; run `npm install` so the lockfile pins one.",
      ],
    })
  })
  it("names the first seven characters of both commits", () => {
    const r = checkPins({
      packageJson: pkg(`github:o/internal-package-contract#${B}`),
      lockfile: lock(A),
      workflows: wf(B, " # v1"),
    })
    expect(r.problems).toEqual([
      "package.json: devDependency is pinned to bbbbbbb but package-lock.json resolved aaaaaaa.",
      "w.yml:2: workflow is pinned to bbbbbbb but package-lock.json resolved aaaaaaa.",
    ])
  })
  it("asks for the comment, with the exact wording, on a commit-pinned devDependency too", () => {
    const r = checkPins({
      packageJson: pkg(`github:o/internal-package-contract#${A}`),
      lockfile: lock(A),
      workflows: wf(A, ""),
    })
    expect(r.problems).toEqual([
      'w.yml:2: add a trailing "# <release>" comment naming the release this commit is.',
    ])
  })
  it("states the release mismatch exactly", () => {
    const r = checkPins({
      packageJson: pkg("github:o/internal-package-contract#v0.10.0"),
      lockfile: lock(A),
      workflows: wf(A, " # v0.9.0"),
    })
    expect(r.problems).toEqual(["w.yml:2: comment says v0.9.0 but the devDependency is v0.10.0."])
  })
  it("does not compare the comment when the ref is not a version", () => {
    const r = checkPins({
      packageJson: pkg("github:o/internal-package-contract#dev1"),
      lockfile: lock(A),
      workflows: wf(A, " # v0.9.0"),
    })
    expect(r.problems).toEqual([])
  })
  it("says the lockfile is missing a commit with applies true", () => {
    expect(
      checkPins({
        packageJson: pkg("github:o/internal-package-contract#v1"),
        lockfile: "{}",
        workflows: wf(A, " # v1"),
      }).applies,
    ).toBe(true)
  })
  it("states the not-a-git-dependency problem exactly", () => {
    expect(
      checkPins({ packageJson: "{}", lockfile: undefined, workflows: wf(A, " # v1") }).problems,
    ).toEqual([
      "package.json: workflows call internal-package-contract but it is not a git devDependency, so the installed checks and the workflows cannot be the same revision.",
    ])
  })
})

describe("pinConsistency (exact policy text)", () => {
  it("names the tool when the script did not run to completion", async () => {
    const r = await pinConsistency().policy(
      makeContext(makeResult({ status: "spawn_error", spawnError: "boom" })),
    )
    expect(r.rationale).toContain("check-pin-consistency could not be spawned")
  })
  it("prefixes unparseable output with its own name", async () => {
    const r = await pinConsistency().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(r.rationale).toMatch(/^Pin consistency: output could not be parsed as JSON\./)
  })
  it("treats an envelope without problems or applies as nothing to compare", async () => {
    const r = await pinConsistency().policy(makeContext(makeJsonResult({ ok: true })))
    expect(r).toEqual({
      outcome: "pass",
      rationale:
        "This repository does not depend on internal-package-contract; nothing to compare.",
    })
  })
})
