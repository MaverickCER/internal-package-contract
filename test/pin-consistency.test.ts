import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { pinConsistency } from "../checks/pin-consistency.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"
import { checkPins, devDependencyRef, workflowPins } from "../scripts/pin-consistency.mjs"

const A = "a".repeat(40)
const B = "b".repeat(40)
const WF = "MaverickCER/internal-package-contract/.github/workflows"

const pkg = (ref: string | undefined) =>
  JSON.stringify({
    devDependencies:
      ref === undefined
        ? {}
        : { "internal-package-contract": `github:MaverickCER/internal-package-contract#${ref}` },
  })
const lock = (sha: string | undefined) =>
  JSON.stringify({
    packages: {
      "node_modules/internal-package-contract": {
        resolved:
          sha === undefined
            ? ""
            : `git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${sha}`,
      },
    },
  })
const uses = (name: string, sha: string, comment: string) =>
  `jobs:\n  x:\n    uses: ${WF}/${name}.yml@${sha}${comment}\n`

describe("devDependencyRef", () => {
  it("reads the ref after the hash of a git dependency", () => {
    expect(devDependencyRef(pkg("v0.10.0"))).toBe("v0.10.0")
  })
  it("is undefined when the package does not depend on it, or the manifest is unreadable", () => {
    expect(devDependencyRef(pkg(undefined))).toBeUndefined()
    expect(devDependencyRef("not json")).toBeUndefined()
    expect(
      devDependencyRef(
        JSON.stringify({ devDependencies: { "internal-package-contract": "1.2.3" } }),
      ),
    ).toBeUndefined()
  })
})

describe("workflowPins", () => {
  it("returns each pin with its line, ref and SHA", () => {
    const text = uses("release", A, " # v0.10.0")
    expect(workflowPins(text)).toEqual([{ line: 3, ref: A, comment: "v0.10.0" }])
  })
  it("records a missing comment as an empty string", () => {
    expect(workflowPins(uses("release", A, ""))[0]?.comment).toBe("")
  })
  it("ignores other repositories' workflows", () => {
    expect(workflowPins("    uses: actions/checkout@v7\n")).toEqual([])
  })
})

describe("checkPins", () => {
  const good = {
    packageJson: pkg("v0.10.0"),
    lockfile: lock(A),
    workflows: [{ file: "release.yml", text: uses("release", A, " # v0.10.0") }],
  }
  it("passes when ref, lockfile and workflows name one revision", () => {
    expect(checkPins(good)).toEqual({ applies: true, problems: [] })
  })
  it("does not apply, and cannot fail, for a repository that does not use the package", () => {
    expect(checkPins({ packageJson: pkg(undefined), lockfile: undefined, workflows: [] })).toEqual({
      applies: false,
      problems: [],
    })
  })
  it("fails when a workflow is pinned to something other than a full commit", () => {
    const r = checkPins({
      ...good,
      workflows: [{ file: "r.yml", text: uses("release", "main", "") }],
    })
    expect(r.problems).toEqual([expect.stringContaining("r.yml:3")])
    expect(r.problems[0]).toContain("full 40-character commit SHA")
  })
  it("fails when the lockfile commit differs from a workflow pin", () => {
    const r = checkPins({ ...good, lockfile: lock(B) })
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain("release.yml:3")
    expect(r.problems[0]).toContain(B.slice(0, 7))
  })
  it("fails when the lockfile pins no commit", () => {
    expect(checkPins({ ...good, lockfile: lock(undefined) }).problems[0]).toContain(
      "package-lock.json",
    )
    expect(checkPins({ ...good, lockfile: undefined }).problems[0]).toContain("package-lock.json")
  })
  it("fails when two workflows pin different commits", () => {
    const r = checkPins({
      ...good,
      workflows: [
        ...good.workflows,
        { file: "sync.yml", text: uses("dependency-pin-sync", B, " # v0.10.0") },
      ],
    })
    expect(r.problems).toEqual([expect.stringContaining("sync.yml:3")])
  })
  it("fails when the trailing comment is missing or names another release", () => {
    expect(
      checkPins({ ...good, workflows: [{ file: "a.yml", text: uses("release", A, "") }] })
        .problems[0],
    ).toContain("a.yml:3")
    const other = checkPins({
      ...good,
      workflows: [{ file: "a.yml", text: uses("release", A, " # v0.9.0") }],
    })
    expect(other.problems[0]).toContain("v0.9.0")
    expect(other.problems[0]).toContain("v0.10.0")
  })
  it("accepts a commit-pinned devDependency whose workflows carry any release comment", () => {
    const r = checkPins({
      ...good,
      packageJson: pkg(A),
      workflows: [{ file: "a.yml", text: uses("release", A, " # v0.10.0") }],
    })
    expect(r.problems).toEqual([])
  })
  it("fails when workflows pin the package but package.json does not depend on it", () => {
    const r = checkPins({ ...good, packageJson: pkg(undefined) })
    expect(r.applies).toBe(true)
    expect(r.problems[0]).toContain("package.json")
  })
})

describe("checkPins (commit-pinned devDependency)", () => {
  it("fails when the devDependency commit differs from the lockfile's", () => {
    const r = checkPins({
      packageJson: pkg(B),
      lockfile: lock(A),
      workflows: [{ file: "a.yml", text: uses("release", A, " # v0.10.0") }],
    })
    expect(r.problems).toEqual([expect.stringContaining("devDependency is pinned to")])
  })
})

describe("pinConsistency (policy)", () => {
  it("runs the bundled offline script and asks for JSON", () => {
    const check = pinConsistency()
    const run = check.run as readonly string[]
    expect(run[0]).toBe("node")
    expect(run[1]).toMatch(/scripts[\\/]check-pin-consistency\.mjs$/)
    expect(run).toHaveLength(2)
    expect(check.output).toEqual({ format: "json" })
  })
  it("fails and lists every problem", async () => {
    const result = await pinConsistency().policy(
      makeContext(
        makeJsonResult({ ok: true, applies: true, problems: ["a.yml:3: x", "b.yml:9: y"] }),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("- a.yml:3: x\n- b.yml:9: y")
    expect(result.rationale).toContain("--repin")
  })
  it("passes and says the pins agree when they were compared", async () => {
    const result = await pinConsistency().policy(
      makeContext(makeJsonResult({ ok: true, applies: true, problems: [] })),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale: "The devDependency, the lockfile and every workflow pin name one revision.",
    })
  })
  it("passes vacuously, and says so, when the package is not used", async () => {
    const result = await pinConsistency().policy(
      makeContext(makeJsonResult({ ok: true, applies: false, problems: [] })),
    )
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("does not depend on")
  })
  it("fails closed on output that is not the envelope", async () => {
    const result = await pinConsistency().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(result.outcome).toBe("fail")
  })
})

describe("check-pin-consistency (script)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pin-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const script = path.resolve(__dirname, "../scripts/check-pin-consistency.mjs")
  const runIn = () => JSON.parse(spawnSync("node", [script], { cwd: dir, encoding: "utf8" }).stdout)

  it("reports not-applicable for a directory with no manifest at all", () => {
    expect(runIn()).toEqual({ ok: true, applies: false, problems: [] })
  })
  it("reads package.json, package-lock.json and every workflow in name order", () => {
    writeFileSync(path.join(dir, "package.json"), pkg("v0.10.0"))
    writeFileSync(path.join(dir, "package-lock.json"), lock(A))
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    writeFileSync(path.join(dir, ".github", "workflows", "b.yml"), uses("release", B, " # v0.10.0"))
    writeFileSync(path.join(dir, ".github", "workflows", "a.yml"), uses("release", A, " # v0.10.0"))
    writeFileSync(path.join(dir, ".github", "workflows", "notes.txt"), uses("release", B, ""))
    const report = runIn()
    expect(report.applies).toBe(true)
    expect(report.problems).toEqual([expect.stringContaining(".github/workflows/b.yml:3")])
  })
})
