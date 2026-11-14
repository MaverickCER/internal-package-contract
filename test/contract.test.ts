import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import contract from "../contract.js"
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

// Mutation testing runs this file from a `.stryker-tmp/sandbox-<id>/` copy whose check sources are
// instrumented, which rewrites their layout. The headers and entries are read from the original tree.
const sandbox = `${path.sep}.stryker-tmp${path.sep}`
const sourceRoot = packageRoot.includes(sandbox)
  ? packageRoot.slice(0, packageRoot.indexOf(sandbox))
  : packageRoot

/**
 * The README's "Blocks on" cells are short paraphrases of each check's doc header, so they cannot be compared
 * word for word. What a reader acts on is whether a check can block and whether it can only warn, and the
 * headers state both in fixed words ("Never fails.", "Never warns.", a sentence that starts with "Warns").
 * A row that disagrees with its header on either fails here. The other wording stays a review concern.
 */
describe("README.md's check rows agree with each check's doc header", () => {
  const readme = readFileSync(path.join(packageRoot, "README.md"), "utf8")
  const standard = readFileSync(path.join(sourceRoot, "checks/standard.ts"), "utf8")
  const moduleOf = new Map(
    [...standard.matchAll(/^import \{ (\w+) \} from "\.\/([\w-]+)\.js"$/gm)].map(
      (match) => [match[1] as string, match[2] as string] as const,
    ),
  )
  const header = (id: string): string | undefined => {
    const entry = new RegExp(`^ {4}${id}: (.*)$`, "m").exec(standard)?.[1] ?? ""
    const name = (entry.match(/\w+/g) ?? []).find((word) => moduleOf.has(word))
    if (name === undefined) return undefined
    const source = readFileSync(path.join(sourceRoot, "checks", `${moduleOf.get(name)}.ts`), "utf8")
    const doc = /\/\*\*([\s\S]*?)\*\//.exec(source)?.[1] ?? ""
    return doc.replace(/\s*\n\s*\*[ \t]?/g, " ")
  }
  const rows = [...readme.matchAll(/^\|\s*`([A-Za-z]+)`\s*\|(.*)\|\s*$/gm)]
    .map((match) => ({ id: match[1] as string, cells: (match[2] as string).split("|") }))
    .filter((row) => row.cells.length >= 2)
    .map((row) => ({ id: row.id, blocksOn: (row.cells.at(-1) as string).trim() }))

  it("reads a header for every row except the checks repo-contract's presets define", () => {
    expect(rows.filter((row) => header(row.id) === undefined).map((row) => row.id)).toEqual([
      "Lint",
      "Format",
      "Typecheck",
      "Packaging",
      "Licenses",
    ])
  })

  it.each(rows.filter((row) => header(row.id) !== undefined))(
    "$id: the row says whether the check can fail and can warn, as its header does",
    ({ id, blocksOn }) => {
      const text = header(id) as string
      const neverFails = /\bNever fails\b/.test(text)
      expect(/^never fails/i.test(blocksOn), `${id} "Never fails"`).toBe(neverFails)
      if (/(?:^|\.\s)Warns\b/.test(text))
        expect(blocksOn, `${id} has a "Warns" sentence`).toMatch(/warn/i)
      else if (/\bNever warns\.(?:\s|$)/.test(text))
        expect(blocksOn, `${id} says "Never warns."`).not.toMatch(/warn/i)
    },
  )

  // A reader accepts a degradation by its id in `environment.json`, so the row names each id exactly.
  const degradationIds = (id: string): string[] => [
    ...new Set(
      [...(header(id) ?? "").matchAll(/`([A-Z][A-Za-z]+:(?:[a-z][a-z0-9-]*|<[a-z]+>))`/g)].map(
        (match) => match[1] as string,
      ),
    ),
  ]

  it("finds the degradation ids the check headers name", () => {
    expect(rows.flatMap((row) => degradationIds(row.id))).toHaveLength(12)
  })

  it.each(rows.filter((row) => degradationIds(row.id).length > 0))(
    "$id: the row names every degradation id its header names",
    ({ id, blocksOn }) => {
      for (const degradation of degradationIds(id)) expect(blocksOn, id).toContain(degradation)
    },
  )

  // An exemption is part of the verdict, so the row names every registry its header reads. The environment
  // registry is the one left out: the degradation ids above stand for it, and one paragraph names it.
  const environmentRegistry = ".repo-contract/exceptions/environment.json"
  const registries = (id: string): string[] => [
    ...new Set(
      [...(header(id) ?? "").matchAll(/`(\.repo-contract\/exceptions\/[a-z-]+\.json)`/g)]
        .map((match) => match[1] as string)
        .filter((file) => file !== environmentRegistry),
    ),
  ]

  it("finds the exception registries the check headers name", () => {
    expect(rows.flatMap((row) => registries(row.id))).toHaveLength(10)
  })

  it.each(rows.filter((row) => registries(row.id).length > 0))(
    "$id: the row names every exception registry its header reads",
    ({ id, blocksOn }) => {
      for (const registry of registries(id)) expect(blocksOn, id).toContain(registry)
    },
  )

  it("names the environment registry where it explains a degradation", () => {
    expect(readme).toContain(`\`${environmentRegistry}\` records \`environment:<id>\``)
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
      "TypeResolution",
      "PackedConsumer",
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
