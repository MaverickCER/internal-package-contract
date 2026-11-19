import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { strict, tierSettings } from "repo-contract/tiers"
import type { ExplainBaseline } from "repo-contract/tiers"
import { runContract } from "../scripts/contract-run.mjs"

let root: string
let exitCode: typeof process.exitCode
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-contract-run-loosened-"))
  exitCode = process.exitCode
})
afterEach(() => {
  process.exitCode = exitCode
  rmSync(root, { recursive: true, force: true })
})

const baseline: ExplainBaseline = {
  name: "internal-package-contract",
  checks: ["Lint", "Mutation", "SecuritySocket"],
  settings: { ...tierSettings("strict"), Mutation: { minScore: 100 } },
  planned: [],
}

/** A repo-contract engine that passes every check it is given, without running anything. */
const passing = (config: unknown) => {
  const ids = Object.keys((config as { checks: Record<string, unknown> }).checks)
  return Promise.resolve({
    evidence: {
      version: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000,
      checks: Object.fromEntries(ids.map((id) => [id, { durationMs: 0, status: "completed" }])),
    },
    verdict: {
      passed: true,
      checks: Object.fromEntries(ids.map((id) => [id, { outcome: "pass", rationale: "ok" }])),
    },
  })
}
const quiet = { write: () => true } as unknown as NodeJS.WritableStream

const run = (config: { checks: Record<string, unknown>; tier?: unknown }, withBaseline = true) =>
  runContract({
    runRepoContract: passing,
    config,
    cwd: root,
    title: "T",
    argv: [],
    env: {},
    out: quiet,
    err: quiet,
    prepare: () => undefined,
    scope: () =>
      Promise.resolve({
        schemaVersion: 1 as const,
        scope: "full" as const,
        reason: "asked",
        changedFiles: [],
        tests: [],
        sources: [],
        mutate: [],
      }),
    ...(withBaseline ? { baseline } : {}),
  })

const written = (file: string): string =>
  readFileSync(path.join(root, "reports", "contract", file), "utf8")

describe("runContract() with the standard as baseline", () => {
  it("writes what the config loosened to report.json and summary.md", async () => {
    const { checks, tier } = strict({ Mutation: { minScore: 80 } })
    await run({ checks: { Lint: checks.Lint, Mutation: checks.Mutation }, tier })
    const report = JSON.parse(written("report.json")) as {
      explanation: { baseline: string; tier: string; missing: string[]; loosened: unknown[] }
    }
    expect(report.explanation.baseline).toBe("internal-package-contract")
    expect(report.explanation.tier).toBe("strict")
    expect(report.explanation.missing).toEqual(["SecuritySocket"])
    expect(report.explanation.loosened).toEqual([
      { check: "Mutation", setting: "minScore", baseline: 100, value: 80 },
      { check: "SecuritySocket", setting: "enabled", baseline: true, value: false },
    ])
    const summary = written("summary.md")
    expect(summary).toContain("### Compared with the standard\n\nTier `strict`, compared with")
    expect(summary).toContain("- Mutation `minScore`: 80 (baseline 100)\n")
  })

  it("compares only the checks of a config that carries no tier", async () => {
    await run({ checks: { Lint: {} } })
    expect(written("summary.md")).toContain(
      "No tier metadata: checks are compared with `internal-package-contract`, settings are not.",
    )
  })

  it("writes no comparison without a baseline or tier metadata", async () => {
    await run({ checks: { Lint: {} } }, false)
    expect(written("summary.md")).not.toContain("Compared with the standard")
  })
})

describe("runContract()'s exception inventory", () => {
  it("is repo-contract's: an unreadable registry is listed, never thrown", async () => {
    mkdirSync(path.join(root, ".repo-contract", "exceptions"), { recursive: true })
    writeFileSync(path.join(root, ".repo-contract", "exceptions", "broken.json"), "{ nope")
    writeFileSync(
      path.join(root, ".repo-contract", "exceptions", "socket.json"),
      JSON.stringify({ exceptions: [{ version: 2, justification: "j" }] }),
    )
    await run({ checks: { Lint: {} } })
    const report = JSON.parse(written("report.json")) as {
      exceptions: {
        schemaVersion: number
        total: number
        incomplete: number
        errors: { name: string }[]
      }
    }
    expect(report.exceptions.schemaVersion).toBe(1)
    expect(report.exceptions.total).toBe(1)
    expect(report.exceptions.incomplete).toBe(1)
    expect(report.exceptions.errors.map(({ name }) => name)).toEqual(["broken"])
  })
})
