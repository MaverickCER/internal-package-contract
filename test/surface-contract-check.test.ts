import { describe, expect, it } from "vitest"
import { evaluateSurfacePolicy, surfaceContract } from "../checks/surface-contract.js"
import type { SurfaceEvidence } from "../scripts/surface-contract/run.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const evidence = (over: Partial<SurfaceEvidence> = {}): SurfaceEvidence => ({
  currentVersion: "0.3.0",
  status: "compared",
  changes: [],
  requiredLevel: "none",
  minimumRequiredVersion: "0.3.0",
  baselineVersion: "0.3.0",
  changesets: { changesetCount: 0, declaredLevel: "none", satisfied: true },
  ...over,
})
const breaking = {
  id: "cli:x:--a",
  kind: "cli-flag-removed",
  impact: "breaking" as const,
  widens: false,
  explanation: "`x` no longer documents --a.",
}

describe("evaluateSurfacePolicy", () => {
  it("passes, saying there is nothing to guard, for a package with no CLI, schema or action", () => {
    expect(evaluateSurfacePolicy(evidence({ status: "no-surface" }))).toEqual({
      outcome: "pass",
      rationale: "SurfaceContract: no CLI, exported JSON Schema or GitHub Action to guard.",
    })
  })
  it("passes and asks for the new baseline to be committed after creating it", () => {
    const r = evaluateSurfacePolicy(evidence({ status: "initial-baseline" }))
    expect(r.outcome).toBe("pass")
    expect(r.rationale).toContain(".repo-contract/surface-contract/baseline.json")
    expect(r.rationale).toContain("commit")
  })
  it("fails in CI when there is a surface and no committed baseline", () => {
    const r = evaluateSurfacePolicy(
      evidence({
        status: "missing-baseline",
        changesets: { changesetCount: 0, declaredLevel: "none", satisfied: false },
      }),
    )
    expect(r.outcome).toBe("fail")
    expect(r.rationale).toContain("npx internal-package-contract update-baseline")
  })
  it("passes with no changes and says so", () => {
    expect(evaluateSurfacePolicy(evidence())).toEqual({
      outcome: "pass",
      rationale: "SurfaceContract: the CLI, schema and action surface is unchanged since 0.3.0.",
    })
  })
  it("fails when the changesets declare less than the surface change needs, naming each change", () => {
    const r = evaluateSurfacePolicy(
      evidence({
        changes: [breaking],
        requiredLevel: "minor",
        minimumRequiredVersion: "0.4.0",
        changesets: { changesetCount: 1, declaredLevel: "patch", satisfied: false },
      }),
    )
    expect(r.outcome).toBe("fail")
    expect(r.rationale).toBe(
      [
        "SurfaceContract: the CLI, schema or action surface changed since 0.3.0:",
        "- [breaking] `x` no longer documents --a. (cli:x:--a)",
        "",
        "Release level: 1 changeset(s) declare `patch`; the surface change requires `minor`.",
        "Run `npx changeset add` and declare a `minor` bump for this change, so Changesets bumps the version correctly.",
      ].join("\n"),
    )
  })
  it("passes when the declaration is enough, listing the changes and the minimum version", () => {
    const r = evaluateSurfacePolicy(
      evidence({
        changes: [{ ...breaking, impact: "compatible", explanation: "added" }],
        requiredLevel: "patch",
        minimumRequiredVersion: "0.3.1",
        changesets: { changesetCount: 2, declaredLevel: "minor", satisfied: true },
      }),
    )
    expect(r.outcome).toBe("pass")
    expect(r.rationale).toBe(
      [
        "SurfaceContract: the CLI, schema or action surface changed since 0.3.0:",
        "- [compatible] added (cli:x:--a)",
        "",
        "Release level: 2 changeset(s) declare `minor`; the surface change requires `patch`.",
        "Minimum required version if released now: 0.3.1.",
      ].join("\n"),
    )
  })
})

describe("evaluateSurfacePolicy (version wording)", () => {
  it("names the baseline version when nothing changed, and the minimum version when it passes", () => {
    expect(evaluateSurfacePolicy(evidence({ baselineVersion: "1.4.0" })).rationale).toContain(
      "since 1.4.0.",
    )
    const r = evaluateSurfacePolicy(
      evidence({
        changes: [breaking],
        baselineVersion: "1.4.0",
        minimumRequiredVersion: "1.5.0",
        requiredLevel: "minor",
      }),
    )
    expect(r.rationale).toContain("changed since 1.4.0:")
    expect(r.rationale).toContain("Minimum required version if released now: 1.5.0.")
  })
})

describe("surfaceContract", () => {
  it("runs the bundled script under tsx and asks for JSON", () => {
    const check = surfaceContract()
    const run = check.run as readonly string[]
    expect(run[0]).toBe("tsx")
    expect(run[1]).toMatch(/scripts[\\/]surface-contract[\\/]run\.ts$/)
    expect(run).toHaveLength(2)
    expect(check.output).toEqual({ format: "json" })
  })
  it("judges the evidence the script printed", async () => {
    const r = await surfaceContract().policy(
      makeContext(makeJsonResult(evidence({ status: "no-surface" }))),
    )
    expect(r.outcome).toBe("pass")
  })
  it("names the check when the script did not run to completion", async () => {
    const r = await surfaceContract().policy(
      makeContext(makeResult({ status: "spawn_error", spawnError: "boom" })),
    )
    expect(r.outcome).toBe("fail")
    expect(r.rationale).toContain("the surface-contract check could not be spawned")
  })
  it("fails closed with no output to show when the script printed nothing", async () => {
    const r = await surfaceContract().policy(makeContext(makeResult({ stdout: "" })))
    expect(r.rationale).toBe("SurfaceContract: check output could not be parsed as JSON.")
  })
  it("fails closed, with its own name, on output that is not JSON", async () => {
    const r = await surfaceContract().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(r.outcome).toBe("fail")
    expect(r.rationale).toBe("SurfaceContract: check output could not be parsed as JSON.\noops")
  })
})
