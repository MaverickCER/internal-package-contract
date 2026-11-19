import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { explainTier, renderExplain, strict, tierChecks, tierSettings } from "repo-contract/tiers"
import type { ExplainBaseline, TierExplanation } from "repo-contract/tiers"
import { OWN_CHECKS_NOTE, renderMarkdown } from "../scripts/contract-report.mjs"
import type { ContractReport } from "../scripts/contract-report.mjs"

const baseline: ExplainBaseline = {
  name: "internal-package-contract",
  checks: ["Lint", "Mutation", "SecuritySocket"],
  settings: { ...tierSettings("strict"), Mutation: { minScore: 100 } },
  planned: [],
}

const report = (explanation?: TierExplanation): ContractReport =>
  ({
    version: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    strict: false,
    passed: true,
    counts: { pass: 1, warn: 0, "not-evaluated": 0, unexcepted: 0, fail: 0, skipped: 0 },
    totalDurationMs: 1000,
    checks: [{ id: "Lint", outcome: "pass", class: "pass", rationale: "ok", durationMs: 1000 }],
    ...(explanation === undefined ? {} : { explanation }),
  }) as ContractReport

describe('the report\'s "Compared with the standard" section', () => {
  it("shows what the contract runs and every setting looser than the standard, before the slowest checks", () => {
    const explanation = explainTier(strict({ Mutation: { minScore: 80 } }), baseline)
    const markdown = renderMarkdown(report(explanation))
    const section = renderExplain(explanation, { format: "markdown", heading: "Loosened" })
    expect(markdown).toContain(
      `\n### Compared with the standard\n\n${section.replaceAll("\n### ", "\n#### ")}\n${OWN_CHECKS_NOTE}\n\n`,
    )
    expect(markdown).toContain("#### Loosened\n\n- Mutation `minScore`: 80 (baseline 100)")
    expect(markdown).toContain("- SecuritySocket: not in checks (baseline runs it)")
    expect(markdown.indexOf("### Compared with the standard")).toBeLessThan(
      markdown.indexOf("### Slowest checks"),
    )
  })

  it("heads its parts one level below the section, so the summary shows one section", () => {
    const explanation = explainTier(strict({ Mutation: { minScore: 80 } }), {
      ...baseline,
      planned: [{ id: "EngineMatrix", tier: "strict", reason: "not built yet" }],
    })
    const markdown = renderMarkdown(report(explanation))
    expect(markdown).not.toMatch(/^### (?:Loosened|Planned for a later release)$/m)
    expect(markdown).toContain("#### Planned for a later release")
  })

  it("says nothing is loosened when the config is the standard", () => {
    const explanation = explainTier(
      { checks: { Lint: {}, Mutation: {}, SecuritySocket: {} } },
      baseline,
    )
    expect(renderMarkdown(report(explanation))).toContain(
      "#### Loosened\n\n- Nothing is loosened.\n",
    )
  })

  it("names every tier check IPC replaces with its own, as checks/standard.ts declares them", () => {
    // A tier check IPC keeps is declared as `Id: tier.Id` or wraps `tier.Id`; any other is IPC's own.
    // Under Stryker this suite runs in .stryker-tmp/<sandbox>/, whose checks/standard.ts is instrumented and no
    // longer has one declaration per line. The project's own copy is the source being described.
    const root = path
      .resolve(import.meta.dirname, "..")
      .replace(/[\\/]\.stryker-tmp[\\/][^\\/]+$/, "")
    const source = readFileSync(path.join(root, "checks", "standard.ts"), "utf8")
    const declared = new Map(
      [...source.matchAll(/^ {4}(\w+): (.+)$/gm)].map(([, id, value]) => [id, value]),
    )
    const replaced = tierChecks("strict").filter(
      (id) => declared.has(id) && !(declared.get(id) ?? "").includes(`tier.${id}`),
    )
    expect(replaced.sort()).toEqual([
      "Commits",
      "DeadCode",
      "DistNoUrls",
      "DocsLinks",
      "SecurityDeps",
      "SecuritySecrets",
      "Tests",
    ])
    expect(OWN_CHECKS_NOTE).toBe(
      "IPC runs its own version of seven tier checks: `Tests`, `SecuritySecrets`, `SecurityDeps`, `DeadCode`, `DocsLinks`, `DistNoUrls` and `Commits`. Their verdicts are not repo-contract's. `checks/standard.ts` says how each one differs.",
    )
  })

  it("is left out when the run had nothing to compare against, or no explanation at all", () => {
    const nothing = explainTier({ checks: { Lint: {} } })
    expect(nothing.baseline).toBeUndefined()
    expect(renderMarkdown(report(nothing))).not.toContain("Compared with the standard")
    expect(renderMarkdown(report())).not.toContain("Compared with the standard")
    expect(renderMarkdown(report())).not.toContain("Loosened")
  })
})
