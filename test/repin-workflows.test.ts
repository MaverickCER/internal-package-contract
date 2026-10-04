import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { repinWorkflowText, repinWorkflows } from "../scripts/repin-workflows.mjs"

const OLD = "1111111111111111111111111111111111111111"
const NEW = "2222222222222222222222222222222222222222"
const DEP = "internal-package-contract"
const base = "MaverickCER/internal-package-contract/.github/workflows"

describe("repinWorkflowText()", () => {
  it("moves a SHA pin and its release comment together", () => {
    const text = `    uses: ${base}/release-npm-changesets.yml@${OLD} # v0.8.0\n`
    expect(repinWorkflowText(text, DEP, NEW, "v0.8.1")).toEqual({
      text: `    uses: ${base}/release-npm-changesets.yml@${NEW} # v0.8.1\n`,
      changed: 1,
    })
  })

  it("replaces a branch or tag pin and a pin with no comment by the SHA pin", () => {
    for (const ref of ["main", "v1", OLD]) {
      const result = repinWorkflowText(
        `uses: ${base}/dependency-pin-sync.yml@${ref}`,
        DEP,
        NEW,
        "v2.0.0",
      )
      expect(result.text).toBe(`uses: ${base}/dependency-pin-sync.yml@${NEW} # v2.0.0`)
      expect(result.changed).toBe(1)
    }
  })

  it("rewrites every call and counts only the ones that changed", () => {
    const text = [
      `uses: ${base}/a.yml@${NEW} # v1.0.0`,
      `uses: ${base}/b.yml@${OLD} # v0.9.0`,
      `uses: ${base}/c.yaml@main`,
    ].join("\n")
    const result = repinWorkflowText(text, DEP, NEW, "v1.0.0")
    expect(result.changed).toBe(2)
    expect(result.text.split("\n")[0]).toBe(`uses: ${base}/a.yml@${NEW} # v1.0.0`)
  })

  it("leaves other actions, other dependencies and local workflows alone", () => {
    const text = [
      "uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
      `uses: MaverickCER/repo-contract/.github/workflows/x.yml@${OLD} # v0.1.0`,
      "uses: ./.github/workflows/dependency-pin-sync.yml",
    ].join("\n")
    expect(repinWorkflowText(text, DEP, NEW, "v1.0.0")).toEqual({ text, changed: 0 })
  })

  it("refuses anything but a full commit SHA", () => {
    expect(() => repinWorkflowText("", DEP, "main", "v1")).toThrow(/Not a full commit SHA/)
    expect(() => repinWorkflowText("", DEP, "2222222", "v1")).toThrow(/Not a full commit SHA/)
  })
})

describe("repinWorkflows() and the CLI", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-repin-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const write = (name: string, body: string) => {
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    writeFileSync(path.join(dir, ".github", "workflows", name), body)
  }

  it("rewrites only the workflow files that pin the dependency, and says which", () => {
    write("release.yml", `uses: ${base}/release-npm-changesets.yml@${OLD} # v0.8.0\n`)
    write("ci.yml", "uses: actions/checkout@v4\n")
    write("notes.txt", `uses: ${base}/x.yml@${OLD}\n`)
    expect(repinWorkflows(dir, DEP, NEW, "v0.8.1")).toEqual([
      path.join(".github", "workflows", "release.yml"),
    ])
    expect(readFileSync(path.join(dir, ".github/workflows/release.yml"), "utf8")).toContain(
      `@${NEW} # v0.8.1`,
    )
    expect(readFileSync(path.join(dir, ".github/workflows/ci.yml"), "utf8")).toBe(
      "uses: actions/checkout@v4\n",
    )
  })

  it("does nothing, without failing, when there is no workflows directory", () => {
    expect(repinWorkflows(dir, DEP, NEW, "v1")).toEqual([])
  })

  it("runs as a script: re-pins, reports, and rejects missing arguments", () => {
    write("release.yml", `uses: ${base}/release-npm-changesets.yml@${OLD}\n`)
    const script = path.resolve(__dirname, "../scripts/repin-workflows.mjs")
    const ok = spawnSync(process.execPath, [script, DEP, NEW, "v0.8.1"], {
      cwd: dir,
      encoding: "utf8",
    })
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain("Re-pinned .github")
    const again = spawnSync(process.execPath, [script, "other-dep", NEW, "v1"], {
      cwd: dir,
      encoding: "utf8",
    })
    expect(again.stdout).toContain("nothing re-pinned")
    const bad = spawnSync(process.execPath, [script, DEP], { cwd: dir, encoding: "utf8" })
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain("Usage:")
  })
})
