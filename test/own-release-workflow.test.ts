import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workflow = parse(readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8")) as {
  on: Record<string, unknown>
  permissions: Record<string, string>
  jobs: {
    release: {
      steps: {
        name?: string
        id?: string
        if?: string
        run?: string
        env?: Record<string, string>
      }[]
    }
  }
}
const steps = workflow.jobs.release.steps
const index = (name: string): number => steps.findIndex((step) => step.name === name)

describe("this repository's own release.yml", () => {
  it("tags only after proving a passing contract run on the same tree", () => {
    const attest = index("Require a passing contract run on this tree")
    const tag = index("Tag the released version (no npm publish; private package)")
    expect(attest).toBeGreaterThan(-1)
    expect(tag).toBeGreaterThan(attest)
    expect(steps[attest]?.if).toBe("steps.version.outputs.tag != ''")
    expect(steps[tag]?.if).toBe("steps.version.outputs.tag != ''")
    expect(steps[attest]?.env?.["GATES_JQ"]).toContain(
      'select(.name == "contract" and .conclusion == "success")',
    )
    expect(steps[attest]?.env?.["GATES_JQ"]).toContain(
      'if $c > 0 and ($r == 0 or $ok > 0) then "pass" else "no" end',
    )
    expect(steps[attest]?.run).toContain('--jq "$GATES_JQ"')
    expect(steps[attest]?.run).toContain("exit 1")
  })

  it("decides the version to tag only when nothing is left to version", () => {
    const version = steps.find((step) => step.id === "version")
    expect(version?.if).toBe("steps.changesets.outputs.hasChangesets != 'true'")
    expect(index("Find the version to tag")).toBeLessThan(
      index("Require a passing contract run on this tree"),
    )
  })

  it("runs again when CI finishes on main, so a tag the first run could not prove is retried", () => {
    expect(workflow.on["workflow_run"]).toEqual({
      workflows: ["CI"],
      types: ["completed"],
      branches: ["main"],
    })
  })

  it("versions and tags only for a push to this repository's own main, never a fork's CI run", () => {
    // `branches: [main]` matches a fork pull request's head branch named main, so the job must check
    // both the triggering event and the head repository.
    const condition = (workflow.jobs.release as { if?: string }).if ?? ""
    expect(condition).toContain("github.event_name == 'push'")
    expect(condition).toContain("github.event.workflow_run.event == 'push'")
    expect(condition).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    )
  })

  it("can read workflow runs, which the attestation needs", () => {
    expect(workflow.permissions["actions"]).toBe("read")
  })
})

describe("this repository's own release.yml on a retry", () => {
  const text = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8")
  it("checks out and tags the commit CI ran on, not the newest main commit", () => {
    expect(text).toContain("TARGET_SHA: ${{ github.event.workflow_run.head_sha || github.sha }}")
    expect(text).toContain("ref: ${{ github.event.workflow_run.head_sha || github.sha }}")
    const tagging = text.slice(text.indexOf("- name: Require a passing contract run on this tree"))
    expect(tagging).not.toContain("$GITHUB_SHA")
    expect(tagging).toContain('git tag "$VERSION" "$TARGET_SHA"')
  })
})
