import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CheckDefinitionConfig, PolicyContext } from "repo-contract"
import { tierSettings } from "repo-contract/tiers"
import {
  COVERAGE_THRESHOLDS,
  CRAP_THRESHOLD,
  DUPLICATION_MAX_PERCENTAGE,
  MAX_COMPLEXITY,
  MUTATION_MIN_SCORE,
  STRYKER_CONFIGS,
  coverageInScope,
  crapInScope,
  mutationOptions,
  standardTier,
  strictOverrides,
} from "../checks/strict.js"
import { bundledConfig } from "../checks/shared.js"
import { makeContext, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-strict-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

const narrow = (tests: string[], sources: string[] = []) => ({
  schemaVersion: 1,
  scope: "affected",
  reason: "r",
  changedFiles: [],
  tests,
  sources,
  mutate: [],
})

/** A policy that records what it was handed and answers with a fixed verdict. */
function recordingCheck(): { check: CheckDefinitionConfig; seen: PolicyContext[] } {
  const seen: PolicyContext[] = []
  return {
    seen,
    check: {
      run: ["tool"],
      policy: (ctx) => {
        seen.push(ctx)
        return { outcome: "pass", rationale: "delegated" }
      },
    },
  }
}

describe("the hardening constants", () => {
  it("hold the standard's limits: 80% on every metric, CRAP 30, complexity 20, 0.75% duplication, 100% mutation", () => {
    expect(COVERAGE_THRESHOLDS).toEqual({ lines: 80, statements: 80, functions: 80, branches: 80 })
    expect(CRAP_THRESHOLD).toBe(30)
    expect(MAX_COMPLEXITY).toBe(20)
    expect(DUPLICATION_MAX_PERCENTAGE).toBe(0.75)
    expect(MUTATION_MIN_SCORE).toBe(100)
  })

  it("are never looser than repo-contract's strict tier", () => {
    const strict = tierSettings("strict")
    for (const [metric, value] of Object.entries(COVERAGE_THRESHOLDS)) {
      expect(value).toBeGreaterThanOrEqual(strict.Coverage[metric as keyof typeof strict.Coverage]!)
    }
    expect(CRAP_THRESHOLD).toBeLessThanOrEqual(strict.Crap.threshold)
    expect(MAX_COMPLEXITY).toBeLessThanOrEqual(strict.Crap.maxComplexity)
    expect(DUPLICATION_MAX_PERCENTAGE).toBeLessThanOrEqual(strict.Duplication.maxPercentage)
    expect(MUTATION_MIN_SCORE).toBeGreaterThan(strict.Mutation.minScore)
  })
})

describe("mutationOptions: the IPC_MUTATION_* variables as preset options", () => {
  it("demands 100% and reuses a clean run locally, with the bundled config when the package has none", () => {
    // Strict: a `shard` or `report` key set to undefined would still reach the preset.
    expect(mutationOptions({})).toStrictEqual({
      minScore: 100,
      cache: "read-write",
      config: bundledConfig("stryker.config.mjs"),
    })
  })

  it("leaves the config to repo-contract when the package has its own", () => {
    writeFileSync(path.join(cwd, "stryker.conf.json"), "{}")
    expect(mutationOptions({}).config).toBeUndefined()
  })

  it("knows each name repo-contract's `mutation run` looks for, in its order, stryker.conf.cjs included", () => {
    const cli = readFileSync(
      path.join(
        import.meta.dirname,
        "..",
        "node_modules",
        "repo-contract",
        "bin",
        "mutation-plan.mjs",
      ),
      "utf8",
    )
    const list = /const CONFIG_CANDIDATES = \[([^\]]+)\]/.exec(cli)?.[1] ?? ""
    expect([...STRYKER_CONFIGS]).toEqual([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]))
    expect(STRYKER_CONFIGS).toHaveLength(9)
    for (const name of STRYKER_CONFIGS) {
      writeFileSync(path.join(cwd, name), "{}")
      expect(mutationOptions({}).config, name).toBeUndefined()
      rmSync(path.join(cwd, name))
    }
  })

  it.each([
    [{ CI: "true" }, "off"],
    [{ CI: "1" }, "off"],
    [{ IPC_MUTATION_MEMO: "0" }, "off"],
    [{ CI: "", IPC_MUTATION_MEMO: "1" }, "read-write"],
    [{ CI: "false" }, "read-write"],
  ])("maps %o to cache %s", (env, cache) => {
    expect(mutationOptions(env).cache).toBe(cache)
  })

  it("mutates one slice for IPC_MUTATION_SHARD, trimmed", () => {
    expect(mutationOptions({ IPC_MUTATION_SHARD: " 2/5 " }).shard).toBe("2/5")
  })

  it("ignores a blank IPC_MUTATION_SHARD and IPC_MUTATION_REPORT", () => {
    const options = mutationOptions({ IPC_MUTATION_SHARD: "  ", IPC_MUTATION_REPORT: " " })
    expect(options.shard).toBeUndefined()
    expect(options.report).toBeUndefined()
  })

  it("judges IPC_MUTATION_REPORT instead of mutating, and drops the shard: a job that judges mutates nothing", () => {
    const options = mutationOptions({
      IPC_MUTATION_REPORT: " merged/mutation.json ",
      IPC_MUTATION_SHARD: "1/2",
    })
    expect(options.report).toBe("merged/mutation.json")
    expect(options.shard).toBeUndefined()
  })
})

describe("strictOverrides: IPC's hardening of repo-contract's strict tier", () => {
  it("passes every IPC limit as an option, so the tier metadata states it", () => {
    const overrides = strictOverrides({})
    expect(overrides.Coverage).toEqual({ thresholds: COVERAGE_THRESHOLDS })
    expect(overrides.Crap).toEqual({
      threshold: 30,
      maxComplexity: 20,
      ignore: ["**/_ipc/**"],
    })
    expect(overrides.Duplication).toEqual({ path: "src", maxPercentage: 0.75 })
    expect(overrides.Build).toEqual({ script: "build", label: "Build", whenMissing: "fail" })
    expect(overrides.Mutation).toEqual(mutationOptions({}))
    expect(overrides.TypeResolution).toEqual({ ignoreResolutions: ["node10"] })
  })

  it("lints the root and docs/ Markdown with the bundled rules when the package has no config", () => {
    expect(strictOverrides({}).DocsMarkdown).toEqual({
      globs: ["*.md", "docs/**/*.md"],
      verdict: "exit-code",
      config: bundledConfig("markdownlint.jsonc"),
    })
  })

  it("leaves the Markdown config to markdownlint-cli2 when the package has its own", () => {
    writeFileSync(path.join(cwd, ".markdownlint.yaml"), "default: true\n")
    expect(strictOverrides({}).DocsMarkdown).toEqual({
      globs: ["*.md", "docs/**/*.md"],
      verdict: "exit-code",
    })
  })

  it("turns no check off", () => {
    expect(Object.values(strictOverrides({})).includes(false)).toBe(false)
  })
})

describe("standardTier", () => {
  it("builds strict with IPC's settings in its metadata, so explain reads them", () => {
    const { tier, checks } = standardTier({ CI: "true" })
    expect(tier.name).toBe("strict")
    expect(tier.off).toEqual([])
    expect(tier.settings).toEqual({
      Coverage: COVERAGE_THRESHOLDS,
      Duplication: { maxPercentage: 0.75 },
      Crap: { threshold: 30, maxComplexity: 20 },
      Mutation: { minScore: 100 },
    })
    expect(checks.Mutation.run).toEqual(
      expect.arrayContaining(["repo-contract", "mutation", "run", "--json", "--cache", "off"]),
    )
    expect(checks.Duplication.run).toEqual([
      "jscpd",
      "src",
      "--reporters",
      "json",
      "--output",
      "reports/jscpd",
      "--silent",
    ])
  })
})

describe("coverageInScope", () => {
  it("warns without judging under --scope affected: a few test files say nothing about the package", async () => {
    const { check, seen } = recordingCheck()
    const verdict = await coverageInScope(check).policy({
      ...makeContext(makeResult()),
      scope: narrow(["test/a.test.ts", "test/b.test.ts"]),
    } as PolicyContext)
    expect(verdict).toEqual({
      outcome: "warn",
      rationale:
        "Coverage: not evaluated: this run covers the 2 test file(s) a change affects, so the package-wide aggregate would say nothing about the package; a full run checks it.",
    })
    expect(seen).toEqual([])
  })

  it("hands a full run to repo-contract's policy, and keeps the evidence half", async () => {
    const { check, seen } = recordingCheck()
    const wrapped = coverageInScope({ ...check, dependsOn: ["Tests"] } as CheckDefinitionConfig)
    const ctx = makeContext(makeResult())
    expect(await wrapped.policy(ctx)).toEqual({ outcome: "pass", rationale: "delegated" })
    expect(seen).toEqual([ctx])
    expect(wrapped).toMatchObject({ run: ["tool"], dependsOn: ["Tests"] })
  })
})

describe("crapInScope", () => {
  const report = "reports/crap.json"
  const functions = [
    { file: "src/a.ts", name: "a", startLine: 1, complexity: 2, crap: 2 },
    { file: path.join("src", "b.ts"), name: "b", startLine: 1, complexity: 40, crap: 99 },
  ]

  function writeReport(): void {
    mkdirSync(path.join(cwd, "reports"), { recursive: true })
    writeFileSync(path.join(cwd, report), JSON.stringify({ functions }))
  }

  it("passes without measuring when no test file is affected", async () => {
    const { check, seen } = recordingCheck()
    expect(
      await crapInScope(check, report).policy({
        ...makeContext(makeResult()),
        scope: narrow([]),
      } as PolicyContext),
    ).toEqual({
      outcome: "pass",
      rationale: "CRAP: no test file is affected, so no function was measured.",
    })
    expect(seen).toEqual([])
  })

  it("judges only the functions in the affected sources: the rest have no coverage worth weighing", async () => {
    writeReport()
    const { check, seen } = recordingCheck()
    const verdict = await crapInScope(check, report).policy({
      ...makeContext(makeResult()),
      scope: narrow(["test/a.test.ts"], ["src/a.ts"]),
    } as PolicyContext)
    expect(verdict).toEqual({ outcome: "pass", rationale: "delegated" })
    expect(seen).toHaveLength(1)
    const judged = JSON.parse(readFileSync(path.join(cwd, report), "utf8")) as {
      functions: unknown[]
    }
    expect(judged.functions).toEqual([functions[0]])
  })

  it("matches an absolute or ./-prefixed path crap4ts reported against the repository-relative source", async () => {
    mkdirSync(path.join(cwd, "reports"), { recursive: true })
    const reported = [
      { ...functions[0], file: path.join(cwd, "src", "a.ts") },
      { ...functions[1], file: "./src/b.ts" },
    ]
    writeFileSync(path.join(cwd, report), JSON.stringify({ functions: reported }))
    const { check } = recordingCheck()
    await crapInScope(check, report).policy({
      ...makeContext(makeResult()),
      scope: narrow(["test/a.test.ts"], ["src/b.ts"]),
    } as PolicyContext)
    const judged = JSON.parse(readFileSync(path.join(cwd, report), "utf8")) as {
      functions: unknown[]
    }
    expect(judged.functions).toEqual([reported[1]])
  })

  it("leaves a missing or unreadable report for repo-contract's policy to fail", async () => {
    const { check, seen } = recordingCheck()
    const ctx = { ...makeContext(makeResult()), scope: narrow(["t"], ["src/a.ts"]) }
    expect(await crapInScope(check, report).policy(ctx as PolicyContext)).toEqual({
      outcome: "pass",
      rationale: "delegated",
    })
    mkdirSync(path.join(cwd, "reports"), { recursive: true })
    writeFileSync(path.join(cwd, report), "{not json")
    await crapInScope(check, report).policy(ctx as PolicyContext)
    writeFileSync(path.join(cwd, report), JSON.stringify({ functions: "x" }))
    await crapInScope(check, report).policy(ctx as PolicyContext)
    expect(readFileSync(path.join(cwd, report), "utf8")).toBe(JSON.stringify({ functions: "x" }))
    writeFileSync(path.join(cwd, report), "null")
    await crapInScope(check, report).policy(ctx as PolicyContext)
    expect(seen).toHaveLength(4)
    expect(readFileSync(path.join(cwd, report), "utf8")).toBe("null")
  })

  it("drops a reported function that names no file, instead of failing on it", async () => {
    mkdirSync(path.join(cwd, "reports"), { recursive: true })
    writeFileSync(
      path.join(cwd, report),
      JSON.stringify({ functions: [{ ...functions[0], file: 42 }, functions[0]] }),
    )
    const { check } = recordingCheck()
    await crapInScope(check, report).policy({
      ...makeContext(makeResult()),
      scope: narrow(["t"], ["src/a.ts"]),
    } as PolicyContext)
    expect(
      (JSON.parse(readFileSync(path.join(cwd, report), "utf8")) as { functions: unknown[] })
        .functions,
    ).toEqual([functions[0]])
  })

  it("refuses to rewrite a report reached through a symbolic link, leaving its target as it was", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "ipc-strict-outside-"))
    try {
      const original = JSON.stringify({ functions })
      writeFileSync(path.join(outside, "crap.json"), original)
      mkdirSync(path.join(cwd, "reports"))
      symlinkSync(path.join(outside, "crap.json"), path.join(cwd, report))
      const ctx = { ...makeContext(makeResult()), scope: narrow(["t"], ["src/a.ts"]) }
      const { check, seen } = recordingCheck()
      expect(await crapInScope(check, report).policy(ctx as PolicyContext)).toEqual({
        outcome: "fail",
        rationale:
          "CRAP: reports/crap.json is a symbolic link, so the narrowed report was not written. A link could point outside the repository; delete it and run again.",
      })
      rmSync(path.join(cwd, "reports"), { recursive: true })
      symlinkSync(outside, path.join(cwd, "reports"))
      expect(await crapInScope(check, report).policy(ctx as PolicyContext)).toEqual({
        outcome: "fail",
        rationale:
          "CRAP: reports is a symbolic link, so the narrowed report was not written. A link could point outside the repository; delete it and run again.",
      })
      expect(seen).toEqual([])
      expect(readFileSync(path.join(outside, "crap.json"), "utf8")).toBe(original)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("hands a full run to repo-contract's policy with the report untouched", async () => {
    writeReport()
    const { check, seen } = recordingCheck()
    const ctx = makeContext(makeResult())
    expect(await crapInScope(check, report).policy(ctx)).toEqual({
      outcome: "pass",
      rationale: "delegated",
    })
    expect(seen).toEqual([ctx])
    expect(JSON.parse(readFileSync(path.join(cwd, report), "utf8"))).toEqual({ functions })
  })
})
