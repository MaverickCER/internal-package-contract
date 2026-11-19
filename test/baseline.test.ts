import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { explainTier, strict } from "repo-contract/tiers"
import { STANDARD_BASELINE_NAME, standardBaseline } from "../checks/baseline.js"
import { standardChecks } from "../checks/standard.js"
import { standardTier } from "../checks/strict.js"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-baseline-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe("standardBaseline", () => {
  it("names the standard and holds every check it runs, in schedule order", () => {
    const baseline = standardBaseline({})
    expect(baseline.name).toBe(STANDARD_BASELINE_NAME)
    expect(STANDARD_BASELINE_NAME).toBe("internal-package-contract")
    expect(baseline.checks).toEqual(Object.keys(standardChecks()))
    expect(baseline.checks).toContain("SecuritySocket")
    expect(baseline.checks.at(-1)).toBe("Mutation")
  })

  it("holds IPC's limits, which are stricter than the tier's", () => {
    expect(standardBaseline({}).settings).toEqual({
      Coverage: { lines: 80, statements: 80, functions: 80, branches: 80 },
      Duplication: { maxPercentage: 0.75 },
      Crap: { threshold: 30, maxComplexity: 20 },
      Mutation: { minScore: 100 },
    })
  })

  it("keeps the same limits whatever the environment says about the run", () => {
    const ci = standardBaseline({ CI: "true", IPC_MUTATION_SHARD: "1/4", IPC_MUTATION_MEMO: "0" })
    expect(ci.settings).toEqual(standardBaseline({}).settings)
    expect(ci.checks).toEqual(standardBaseline({}).checks)
  })

  it("lists only the tier's planned checks the standard does not already run", () => {
    const baseline = standardBaseline({})
    const planned = standardTier({}).tier.planned
    expect(planned.map(({ id }) => id)).toContain("DocsFragments")
    expect(baseline.planned).toEqual(planned.filter(({ id }) => !baseline.checks.includes(id)))
    expect(baseline.planned.map(({ id }) => id)).not.toContain("DocsFragments")
  })

  it("keeps a planned check the standard does not run yet", () => {
    const { tier } = standardTier({})
    // repo-contract types the ids it plans today; a later release may plan one IPC does not run.
    const first = tier.planned[0]
    if (first === undefined) throw new Error("the tier plans no check")
    const future = { ...first, id: "FutureCheck" as typeof first.id }
    const baseline = standardBaseline(
      {},
      { settings: tier.settings, planned: [...tier.planned, future] },
    )
    expect(baseline.planned).toEqual([future])
    expect(baseline.settings).toBe(tier.settings)
  })
})

describe("a config compared with the standard", () => {
  it("loosens nothing when it is the standard itself", () => {
    const explanation = explainTier(
      { checks: standardChecks(), tier: standardTier({}).tier },
      standardBaseline({}),
    )
    expect(explanation.baseline).toBe("internal-package-contract")
    expect(explanation.tier).toBe("strict")
    expect(explanation.missing).toEqual([])
    expect(explanation.loosened).toEqual([])
  })

  it("names a lower mutation floor and each check the config leaves out", () => {
    const tier = strict({ Mutation: { minScore: 80 } })
    const explanation = explainTier(tier, standardBaseline({}))
    expect(explanation.loosened).toContainEqual({
      check: "Mutation",
      setting: "minScore",
      baseline: 100,
      value: 80,
    })
    expect(explanation.missing).toContain("SecuritySocket")
    expect(explanation.loosened).toContainEqual({
      check: "SecuritySocket",
      setting: "enabled",
      baseline: true,
      value: false,
    })
    expect(explanation.missing).not.toContain("Mutation")
  })

  it("compares only the checks of a config without tier metadata", () => {
    const explanation = explainTier({ checks: { Lint: {} } }, standardBaseline({}))
    expect(explanation.tier).toBeUndefined()
    expect(explanation.loosened.every((loosening) => loosening.setting === "enabled")).toBe(true)
    expect(explanation.missing).toContain("Mutation")
  })
})
