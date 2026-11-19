import { beforeEach, describe, expect, it } from "vitest"
import type { CheckDefinitionConfig } from "repo-contract"
import { standardChecks } from "../checks/standard.js"
import { COVERAGE_THRESHOLDS } from "../checks/strict.js"
import contract from "../contract.js"
import { makeContext, makeResult } from "./support.js"

type Checks = Record<string, CheckDefinitionConfig & { dependsOn?: readonly string[] }>
// Built inside each test: mutation testing credits a test only with the code that runs during it.
let checks: Checks
beforeEach(() => {
  checks = standardChecks()
})
const run = (id: string): readonly string[] => checks[id]?.run as readonly string[]

describe("the standard on repo-contract's strict tier", () => {
  it("reads what Tests wrote in order: Coverage after Tests, Crap after Coverage", () => {
    expect(checks["Coverage"]?.dependsOn).toEqual(["Tests"])
    expect(checks["Crap"]?.dependsOn).toEqual(["Coverage"])
    expect(run("Coverage").slice(0, 2)).toEqual(["node", "-e"])
    expect(run("Crap")).toEqual(
      expect.arrayContaining(["crap4ts", "src", "--threshold", "30", "--ignore", "**/_ipc/**"]),
    )
  })

  it("keeps IPC's own Tests: the package's Vitest config writes the coverage, not the tier's flags", () => {
    expect(run("Tests")).not.toContain("--coverage.enabled")
    expect(checks["Tests"]?.isolated).toBe(true)
  })

  it("runs Mutation isolated, through repo-contract's mutation command", () => {
    expect(checks["Mutation"]?.isolated).toBe(true)
    expect(run("Mutation").slice(0, 4)).toEqual(["repo-contract", "mutation", "run", "--json"])
    expect(Object.keys(checks).at(-1)).toBe("Mutation")
  })

  it("runs the package's npm scripts through repo-contract's npm-script command", () => {
    expect(run("Build")).toEqual(["repo-contract", "npm-script", "build", "--json"])
    expect(checks["Build"]?.isolated).toBe(true)
    expect(run("Schema")).toEqual([
      "repo-contract",
      "npm-script",
      "schema",
      "--json",
      "--must-not-change",
      "schemas",
    ])
    expect(run("ApiDocsReport")).toContain("docs/api-report")
  })

  it("names each npm-script check by its label when the script's report cannot be read", async () => {
    const labels = {
      ApiDocs: "API docs",
      ApiDocsReport: "API docs report",
      ReadmeExample: "README example freshness",
      Schema: "Schema",
      Size: "Size",
    }
    for (const [id, label] of Object.entries(labels)) {
      expect(await checks[id]?.policy(makeContext(makeResult()))).toEqual({
        outcome: "fail",
        rationale: `${label}: \`repo-contract npm-script\` printed no readable report.`,
      })
    }
  })

  it("packs for TypeResolution through run-attw.mjs, after Tests", () => {
    expect(run("TypeResolution").at(-1)).toBe("--exclude=schema")
    expect(checks["TypeResolution"]?.dependsOn).toEqual(["Tests"])
  })

  it("runs PackedConsumer and QuickStart after Tests, since each packs a tarball too", () => {
    expect(checks["PackedConsumer"]?.dependsOn).toEqual(["Tests"])
    expect(checks["QuickStart"]?.dependsOn).toEqual(["Tests"])
  })

  it("carries the tier's metadata with IPC's settings, so explain judges the real ones", () => {
    const { tier } = contract as unknown as {
      tier: { name: string; off: readonly string[]; settings: Record<string, unknown> }
    }
    expect(tier.name).toBe("strict")
    expect(tier.off).toEqual([])
    expect(tier.settings).toMatchObject({
      Coverage: COVERAGE_THRESHOLDS,
      Mutation: { minScore: 100 },
      Duplication: { maxPercentage: 0.75 },
    })
  })
})
