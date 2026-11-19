import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import contract from "../contract.js"
import { OPTIONAL_CHECKS } from "../checks/optional.js"
import { packageRoot } from "../checks/shared.js"

/**
 * Guards against exactly the drift `README.md`'s "The checks" section is
 * prone to: a check added/removed/renamed in `contract.ts` without the README
 * table following. Parses the table mechanically rather than re-deriving the
 * check list by hand, so this test itself can't drift the same way.
 */
function extractDocumentedCheckNames(readme: string): readonly string[] {
  // Every check, `Build` included, is a table row (`| `Name` | ... |`).
  const tableRowPattern = /^\|\s*`([A-Za-z]+)`\s*\|/gm
  return [...readme.matchAll(tableRowPattern)].map((match) => match[1] as string)
}

describe("README.md's check table", () => {
  const readme = readFileSync(path.join(packageRoot, "README.md"), "utf8")
  const actualChecks = Object.keys(contract.checks)
  const documentedChecks = extractDocumentedCheckNames(readme)

  it("does not hard-code the number of checks in its heading", () => {
    expect(readme).toMatch(/^## The checks$/m)
    expect(readme).not.toMatch(/^## The \d+ checks/m)
  })

  it("lists exactly the checks contract.ts actually declares, no more, no fewer", () => {
    expect(new Set(documentedChecks)).toStrictEqual(new Set(actualChecks))
  })
})

describe("README.md's optional checks", () => {
  const readme = readFileSync(path.join(packageRoot, "README.md"), "utf8")
  const section = readme.split(/^## Optional checks$/m)[1]?.split(/^## /m)[0] ?? ""

  it.each(Object.keys(OPTIONAL_CHECKS))("%s is named in the Optional checks section", (id) => {
    expect(section).toContain(`\`${id}\``)
  })
})

/**
 * The check tables are the README's generated `checks` region (scripts/generate/checks.mjs). `GeneratedRegions`
 * and test/generate-standard-regions.test.ts keep them current. What a reader acts on is still pinned here: every
 * degradation id and exception registry a header names reaches its row.
 */
describe("README.md's check rows come from each check's doc header", () => {
  const readme = readFileSync(path.join(packageRoot, "README.md"), "utf8")
  const region =
    readme.split("<!-- ipc:begin checks -->")[1]?.split("<!-- ipc:end checks -->")[0] ?? ""
  const rows = [...region.matchAll(/^\|\s*`([A-Za-z]+)`\s*\|(.*)\|\s*$/gm)].map((match) => ({
    id: match[1] as string,
    cells: (match[2] as string).split("|").map((cell) => cell.trim()),
  }))

  it("lists every check inside the generated region", () => {
    expect(rows.map((row) => row.id)).toEqual(Object.keys(contract.checks))
  })

  // A reader accepts a degradation by its id in `environment.json`, so the rows name each id exactly.
  it("names the degradation ids and exception registries the check headers name", () => {
    const named = (column: number, pattern: RegExp): string[] =>
      rows.flatMap((row) =>
        [...(row.cells[column] ?? "").matchAll(pattern)].map((m) => m[1] as string),
      )
    expect(named(1, /`([A-Z][A-Za-z]+:(?:[a-z][a-z0-9-]*|<[a-z]+>))`/g)).toHaveLength(13)
    expect(named(2, /`(\.repo-contract\/exceptions\/[a-z-]+\.json)`/g)).toHaveLength(10)
  })

  // The environment registry is left out of the rows: the degradation ids stand for it, and one paragraph names it.
  it("names the environment registry where it explains a degradation", () => {
    expect(readme).toContain(
      "`.repo-contract/exceptions/environment.json` records `environment:<id>`",
    )
  })
})

describe("the promised surface", () => {
  it("pins the check ids: adding, removing or renaming one is a versioned decision, never an accident", () => {
    expect(Object.keys(contract.checks)).toEqual([
      "ApiDocs",
      "ApiDocsReport",
      "ReadmeExample",
      "Lint",
      "Format",
      "Schema",
      "Build",
      "ApiContract",
      "SurfaceContract",
      "Typecheck",
      "CleanCheckout",
      "Tests",
      "Architecture",
      "GithubActions",
      "GitHygiene",
      "GitHooks",
      "LandingPage",
      "AdoptionMode",
      "GeneratedRegions",
      "PromptBlocks",
      "EnvContract",
      "ReadmeStructure",
      "ScorecardWorkflow",
      "EngineMatrix",
      "ManagedFiles",
      "PinConsistency",
      "BranchProtection",
      "Coverage",
      "Crap",
      "Size",
      "NoMinify",
      "DistNoUrls",
      "Duplication",
      "Packaging",
      "BundledDependencies",
      "TypeResolution",
      "PackedConsumer",
      "QuickStart",
      "Licenses",
      "DocsMarkdown",
      "BenchmarkGuides",
      "BenchmarkComplexity",
      "BenchmarkCoverage",
      "DocsLinks",
      "DocsFragments",
      "Prose",
      "Accessibility",
      "SecurityDeps",
      "SecurityDevDeps",
      "SecuritySecrets",
      "SecuritySocket",
      "CodeScanning",
      "Suppressions",
      "DeadCode",
      "Commits",
      "CodeRabbit",
      "Mutation",
    ])
  })
})
