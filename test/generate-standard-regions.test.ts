import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  COVERAGE_THRESHOLDS,
  CRAP_THRESHOLD,
  DUPLICATION_MAX_PERCENTAGE,
  MAX_COMPLEXITY,
  MUTATION_MIN_SCORE,
} from "../checks/strict.js"
import { packageRoot } from "../checks/shared.js"
import contract from "../contract.js"
import { DEFAULT_DAYS } from "../scripts/adoption/mode.mjs"
import { DEFAULT_GATES } from "../scripts/benchmark/gates.mjs"
import { checksRegion } from "../scripts/generate/checks.mjs"
import { findRegions } from "../scripts/generate/regions.mjs"
import { run } from "../scripts/generate/run.mjs"
import { STANDARD_ROOT, thresholdsRegion } from "../scripts/generate/thresholds.mjs"
import { MAX_LINES } from "../scripts/readme/validate.mjs"

// Mutation testing runs this file from a `.stryker-tmp/sandbox-<id>/` copy whose check sources are
// instrumented, which rewrites their layout. The sources are read from the original tree.
const sandbox = `${path.sep}.stryker-tmp${path.sep}`
const sourceRoot = packageRoot.includes(sandbox)
  ? packageRoot.slice(0, packageRoot.indexOf(sandbox))
  : packageRoot

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-standard-regions-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}

describe("STANDARD_ROOT", () => {
  it("is this package's root", () => {
    expect(STANDARD_ROOT).toBe(path.resolve(import.meta.dirname, ".."))
  })
})

describe("thresholdsRegion", () => {
  const hardening = (text: string): void => write("checks/strict.ts", text)
  const coverage =
    "export const COVERAGE_THRESHOLDS = {\n  lines: 81,\n  statements: 82,\n  functions: 83,\n  branches: 84.5,\n} as const\n"
  const limits =
    "export const CRAP_THRESHOLD = 31\n// x\nexport const MAX_COMPLEXITY = 21;\nexport const DUPLICATION_MAX_PERCENTAGE = 0.5\nexport const MUTATION_MIN_SCORE = 99\n"
  const setBy = (name: string) =>
    `\`${name}\` in \`checks/strict.ts\`, passed to repo-contract's \`strict()\``

  it("reads each limit from the constant that sets it, one row each", () => {
    hardening(coverage + limits)
    const gates = DEFAULT_GATES.normalizedOverheadMaxIncreasePercent
    expect(thresholdsRegion(dir)).toEqual({
      problems: [],
      markdown: [
        "| What is measured | Limit | Set by |",
        "| --- | --- | --- |",
        `| Coverage of lines | at least 81% | ${setBy("COVERAGE_THRESHOLDS")} |`,
        `| Coverage of statements | at least 82% | ${setBy("COVERAGE_THRESHOLDS")} |`,
        `| Coverage of functions | at least 83% | ${setBy("COVERAGE_THRESHOLDS")} |`,
        `| Coverage of branches | at least 84.5% | ${setBy("COVERAGE_THRESHOLDS")} |`,
        `| CRAP score of one function | at most 31 | ${setBy("CRAP_THRESHOLD")} |`,
        `| Cyclomatic complexity of one function | at most 21 | ${setBy("MAX_COMPLEXITY")} |`,
        `| Duplicated share of the code | at most 0.5% | ${setBy("DUPLICATION_MAX_PERCENTAGE")} |`,
        `| Mutation score: mutants detected, or covered by a record | at least 99% | ${setBy("MUTATION_MIN_SCORE")} |`,
        `| Benchmark overhead growth, work of ${String(gates.microscaleBelowMs)} ms or more | at most ${String(gates.millisecondScale)}% | \`DEFAULT_GATES\` in \`scripts/benchmark/gates.mjs\`. A package may override it. |`,
        `| Benchmark overhead growth, work under ${String(gates.microscaleBelowMs)} ms | at most ${String(gates.microsecondScale)}% | \`DEFAULT_GATES\` in \`scripts/benchmark/gates.mjs\`. A package may override it. |`,
        `| README length of a published package | at most ${String(MAX_LINES)} lines | \`MAX_LINES\` in \`scripts/readme/validate.mjs\` |`,
        `| Adoption period | ${String(DEFAULT_DAYS)} days | \`DEFAULT_DAYS\` in \`scripts/adoption/mode.mjs\` |`,
      ].join("\n"),
    })
  })

  it("states a score of 100 as exactly 100%, since none is higher", () => {
    hardening(coverage + limits.replace("MUTATION_MIN_SCORE = 99", "MUTATION_MIN_SCORE = 100"))
    expect(thresholdsRegion(dir).markdown).toContain(
      `| Mutation score: mutants detected, or covered by a record | 100% | ${setBy("MUTATION_MIN_SCORE")} |`,
    )
  })

  it("names the source it cannot read, and each constant it was looking for", () => {
    expect(thresholdsRegion(dir).problems).toEqual(
      [
        "COVERAGE_THRESHOLDS",
        "CRAP_THRESHOLD",
        "MAX_COMPLEXITY",
        "DUPLICATION_MAX_PERCENTAGE",
        "MUTATION_MIN_SCORE",
      ].map((name) => `checks/strict.ts not found; the "thresholds" region reads ${name} from it.`),
    )
    // A limit it could not read is left blank rather than guessed.
    expect(thresholdsRegion(dir).markdown).toContain("| CRAP score of one function | at most  |")
    hardening("export const COVERAGE_THRESHOLDS = {} as const\nconst CRAP_THRESHOLD = 30\n")
    expect(thresholdsRegion(dir).problems).toEqual([
      'checks/strict.ts sets no number in COVERAGE_THRESHOLDS for the "thresholds" region.',
      'checks/strict.ts has no `export const CRAP_THRESHOLD = <number>` for the "thresholds" region.',
      'checks/strict.ts has no `export const MAX_COMPLEXITY = <number>` for the "thresholds" region.',
      'checks/strict.ts has no `export const DUPLICATION_MAX_PERCENTAGE = <number>` for the "thresholds" region.',
      'checks/strict.ts has no `export const MUTATION_MIN_SCORE = <number>` for the "thresholds" region.',
    ])
  })

  it("reads only a whole declaration: a longer name, a computed value or a missing object is not one", () => {
    hardening(
      [
        "export const COVERAGE_THRESHOLDS_OLD = {\n  lines: 1,\n}",
        "// export const COVERAGE_THRESHOLDS = {\n  lines: 1,\n}",
        "export const CRAP_THRESHOLD_MAX = 30",
        "export const MAX_COMPLEXITY = 2 * 10",
        "export const DUPLICATION_MAX_PERCENTAGE = 0.75 // a comment",
        "export const MUTATION_MIN_SCORE = Number(100)",
        "",
      ].join("\n"),
    )
    expect(thresholdsRegion(dir).problems).toEqual([
      'checks/strict.ts has no `export const COVERAGE_THRESHOLDS = { ... }` for the "thresholds" region.',
      'checks/strict.ts has no `export const CRAP_THRESHOLD = <number>` for the "thresholds" region.',
      'checks/strict.ts has no `export const MAX_COMPLEXITY = <number>` for the "thresholds" region.',
      'checks/strict.ts has no `export const DUPLICATION_MAX_PERCENTAGE = <number>` for the "thresholds" region.',
      'checks/strict.ts has no `export const MUTATION_MIN_SCORE = <number>` for the "thresholds" region.',
    ])
    expect(thresholdsRegion(dir).markdown).toContain(
      "| Cyclomatic complexity of one function | at most  |",
    )
  })

  it("states the values the real constants hold", () => {
    const { problems, markdown } = thresholdsRegion(sourceRoot)
    expect(problems).toEqual([])
    for (const [metric, value] of Object.entries(COVERAGE_THRESHOLDS)) {
      expect(markdown).toContain(`| Coverage of ${metric} | at least ${String(value)}% |`)
    }
    expect(markdown).toContain(`| at most ${String(CRAP_THRESHOLD)} | \`CRAP_THRESHOLD\``)
    expect(markdown).toContain(`| at most ${String(MAX_COMPLEXITY)} | \`MAX_COMPLEXITY\``)
    expect(markdown).toContain(
      `| at most ${String(DUPLICATION_MAX_PERCENTAGE)}% | \`DUPLICATION_MAX_PERCENTAGE\``,
    )
    expect(MUTATION_MIN_SCORE).toBe(100)
    expect(markdown).toContain(`| 100% | \`MUTATION_MIN_SCORE\``)
  })
})

describe("checksRegion", () => {
  const header = (id: string, summary: string, extra = "") =>
    `/**\n * \`${id}\`: ${summary}\n *\n * Reads: x.${extra}\n */\nexport const x = 1\n`
  const standard = (body: string) =>
    [
      'import { npmScript } from "repo-contract/presets"',
      'import { alpha } from "./alpha.js"',
      'import { beta } from "./beta.js"',
      'import { gamma, scoped } from "./wrappers.js"',
      "",
      "export function standardChecks() {",
      "  const tier = standardTier().checks",
      "  return withErrorHeadline({",
      body,
      "  })",
      "}",
      "",
    ].join("\n")
  const fixture = (body: string): void => {
    write("checks/standard.ts", standard(body))
    write(
      "checks/alpha.ts",
      header(
        "Alpha",
        "every alpha holds,\n * across lines.",
        " A degradation `Alpha:no-net`, again `Alpha:no-net`, and `Alpha:<url>`. Records in `.repo-contract/exceptions/alpha.json`; `.repo-contract/exceptions/environment.json` accepts a degradation",
      ),
    )
    write("checks/beta.ts", header("Beta", "`beta` is fine."))
    write("checks/wrappers.ts", header("Gamma", "a wrapper with its own header."))
  }
  const body = [
    "    // (Writers)",
    '    Docs: npmScript({ script: "docs", label: "Docs" }),',
    '    Pack: npmScript({ script: "pack", label: "Pack", whenMissing: "fail" }),',
    "    Report: npmScript({",
    '      script: "docs:report",',
    '      label: "Report",',
    '      mustNotChange: ["docs/report"],',
    "    }),",
    "    Lint: tier.Lint,",
    "",
    "    // (Build barrier)",
    "    Build: tier.Build,",
    "",
    "    // (Readers)",
    "    Alpha: alpha(),",
    "    // A comment that names Beta: beta",
    '    Beta: { ...beta, dependsOn: ["Alpha"] as const },',
    "    Format: tier.Format,",
    '    Coverage: { ...scoped(tier.Coverage), dependsOn: ["Beta"] as const },',
    "    Gamma: gamma({",
    "      Base: tier.Gamma,",
    "    }),",
    "    Mutation: tier.Mutation,",
  ].join("\n")
  const table = (rows: string[]) =>
    [
      "| Check | What it holds | Degradations | Exception registry | Defined in |",
      "| --- | --- | --- | --- | --- |",
      ...rows,
    ].join("\n")

  it("writes one table per phase, each check's summary from its header, in declaration order", () => {
    fixture(body)
    expect(checksRegion(dir)).toEqual({
      problems: [],
      markdown: [
        "### 1. Writers",
        "",
        "Writers run first, in order.",
        "",
        table([
          "| `Docs` | The package's `npm run docs` passes. It passes with a note when the script is absent. | none | none | `repo-contract/presets` |",
          "| `Pack` | The package's `npm run pack` passes. It fails when the script is absent. | none | none | `repo-contract/presets` |",
          "| `Report` | The package's `npm run docs:report` passes and leaves `docs/report` unchanged. It passes with a note when the script is absent. | none | none | `repo-contract/presets` |",
          "| `Lint` | ESLint reports no error. A warning warns. | none | none | `repo-contract/tiers` |",
        ]),
        "",
        "### 2. Build barrier",
        "",
        "Writers finish first and readers wait, so the packaging checks see a fresh `dist/`.",
        "",
        table([
          "| `Build` | The package's `npm run build` passes. It fails when the script is absent. | none | none | `repo-contract/tiers` |",
        ]),
        "",
        "### 3. Readers",
        "",
        "Readers run concurrently, except where `isolated` or `dependsOn` says otherwise.",
        "",
        table([
          "| `Alpha` | Every alpha holds, across lines. | `Alpha:no-net`, `Alpha:<url>` | `.repo-contract/exceptions/alpha.json` | `checks/alpha.ts` |",
          "| `Beta` | `beta` is fine. | none | none | `checks/beta.ts` |",
          "| `Format` | Prettier finds every file formatted. | none | none | `repo-contract/tiers` |",
          "| `Coverage` | The package-wide test coverage holds the standard's thresholds. Under `--scope affected` it warns without judging. | none | none | `repo-contract/tiers`, `checks/wrappers.ts` |",
          "| `Gamma` | A wrapper with its own header. | none | none | `checks/wrappers.ts` |",
          "| `Mutation` | Every Stryker mutant is detected, or a hand-verified record covers it. None times out. | none | `.repo-contract/exceptions/mutation.json` | `repo-contract/tiers` |",
        ]),
      ].join("\n"),
    })
  })

  it("names what it cannot read: the standard, a header, a phase, or a check it cannot place", () => {
    expect(checksRegion(dir)).toEqual({
      problems: ['checks/standard.ts not found; the "checks" region lists its checks.'],
      markdown: "",
    })
    fixture(["    // (Writers)", "    Alpha: alpha(),", "    Mystery: mystery(),"].join("\n"))
    write("checks/alpha.ts", "/** No summary here. */\n")
    expect(checksRegion(dir).problems).toEqual([
      'checks/standard.ts has no "// (Build barrier)" marker for the "checks" region.',
      'checks/standard.ts has no "// (Readers)" marker for the "checks" region.',
      'checks/alpha.ts: the doc header does not open with "`Alpha`: what it holds." for the "checks" region.',
      'checks/standard.ts: no module or preset defines `Mystery` for the "checks" region.',
    ])
    fixture(body.replace("    // (Writers)\n", ""))
    rmSync(path.join(dir, "checks/beta.ts"))
    const { problems, markdown } = checksRegion(dir)
    expect(problems).toEqual([
      'checks/standard.ts has no "// (Writers)" marker for the "checks" region.',
      'checks/beta.ts not found; the "checks" region reads `Beta` from its header.',
    ])
    // The checks above the first marker have no phase, so no table lists them.
    expect(markdown).toContain("| `Build` |")
    for (const id of ["Docs", "Pack", "Report", "Lint"]) expect(markdown).not.toContain(`\`${id}\``)
  })

  it("places a tier check only when it describes that id: a tier id it does not know is a problem", () => {
    fixture(`${body}\n    QuickStart: tier.QuickStart,\n    Lint2: tier.Lint,\n    Crap: crap(),`)
    expect(checksRegion(dir).problems).toEqual([
      'checks/standard.ts: no module or preset defines `QuickStart` for the "checks" region.',
      'checks/standard.ts: no module or preset defines `Lint2` for the "checks" region.',
      'checks/standard.ts: no module or preset defines `Crap` for the "checks" region.',
    ])
  })

  it("describes a tier check from its wrapper's header when that header opens on the check's id", () => {
    fixture(body)
    write("checks/wrappers.ts", header("Coverage", "every line runs."))
    const { problems, markdown } = checksRegion(dir)
    expect(markdown).toContain(
      "| `Coverage` | Every line runs. | none | none | `checks/wrappers.ts` |",
    )
    expect(problems).toEqual([
      'checks/wrappers.ts: the doc header does not open with "`Gamma`: what it holds." for the "checks" region.',
    ])
  })

  it("reads a header only when it opens on its own check's id", () => {
    fixture(body)
    write("checks/beta.ts", header("Gamma", "wrong id."))
    expect(checksRegion(dir).problems).toEqual([
      'checks/beta.ts: the doc header does not open with "`Beta`: what it holds." for the "checks" region.',
    ])
    write("checks/beta.ts", "export const beta = 1\n")
    expect(checksRegion(dir).problems).toEqual([
      'checks/beta.ts: the doc header does not open with "`Beta`: what it holds." for the "checks" region.',
    ])
  })

  it("reads a one-line header, and an indented header with no blank line", () => {
    fixture(body)
    write("checks/beta.ts", "/** `Beta`: 2 * 3 holds. */\n")
    write("checks/wrappers.ts", "  /**\n   * `Gamma`: an indented header.\n   */\n")
    const { problems, markdown } = checksRegion(dir)
    expect(problems).toEqual([])
    expect(markdown).toContain("| `Beta` | 2 * 3 holds. | none | none | `checks/beta.ts` |")
    expect(markdown).toContain(
      "| `Gamma` | An indented header. | none | none | `checks/wrappers.ts` |",
    )
  })

  it("reads an import only from a whole import line, not a commented-out or annotated one", () => {
    const imports = [
      'import { npmScript } from "repo-contract/presets"',
      'import { alpha } from "./alpha.js"',
    ]
    for (const edit of [(line: string) => `// ${line}`, (line: string) => `${line} // a note`]) {
      fixture(body)
      const standardFile = path.join(dir, "checks/standard.ts")
      let text = readFileSync(standardFile, "utf8")
      for (const line of imports) text = text.replace(line, edit(line))
      writeFileSync(standardFile, text)
      expect(checksRegion(dir).problems).toEqual(
        ["Docs", "Pack", "Report", "Alpha"].map(
          (id) =>
            `checks/standard.ts: no module or preset defines \`${id}\` for the "checks" region.`,
        ),
      )
    }
  })

  it("names an npmScript entry whose script is not a literal, instead of guessing it", () => {
    fixture(`${body}\n    Size: npmScript(sizeOptions),`)
    expect(checksRegion(dir).problems).toEqual([
      'checks/standard.ts: `Size` gives `npmScript` no literal `script: "..."` for the "checks" region.',
    ])
  })

  it("lists every check the contract declares, each from a header or a preset", () => {
    const { problems, markdown } = checksRegion(sourceRoot)
    expect(problems).toEqual([])
    const ids = [...markdown.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((match) => match[1])
    expect(ids).toEqual(Object.keys(contract.checks))
  })
})

describe("generate: the thresholds and checks regions", () => {
  it("is current in this package's README", async () => {
    const readme = readFileSync(path.join(sourceRoot, "README.md"), "utf8")
    const names = findRegions(readme).regions.map((region) => region.name)
    expect(names).toEqual(expect.arrayContaining(["thresholds", "checks"]))
    const errors: string[] = []
    const io = { out: () => {}, err: (text: string) => errors.push(text) }
    expect(await run(["--check"], sourceRoot, io, { standardRoot: sourceRoot })).toBe(0)
    expect(errors).toEqual([])
  })

  it("needs no docs/surface.json for either region", async () => {
    write("package.json", JSON.stringify({ name: "x" }))
    write("README.md", "# X\n\n<!-- ipc:begin thresholds -->\n<!-- ipc:end thresholds -->\n")
    const errors: string[] = []
    write(
      "README.md",
      "# X\n\n<!-- ipc:begin thresholds -->\n<!-- ipc:end thresholds -->\n\n<!-- ipc:begin checks -->\n<!-- ipc:end checks -->\n",
    )
    const code = await run(
      [],
      dir,
      { out: () => {}, err: (t) => errors.push(t) },
      {
        formatOptions: () => Promise.resolve({}),
        standardRoot: sourceRoot,
      },
    )
    expect(errors).toEqual([])
    expect(code).toBe(0)
    const written = readFileSync(path.join(dir, "README.md"), "utf8")
    expect(written).toMatch(/\| What is measured +\| Limit +\| Set by +\|/)
    expect(written).toContain("### 3. Readers")
  })

  it("reads the standard from the root it is given", async () => {
    write("package.json", JSON.stringify({ name: "x" }))
    write("README.md", "# X\n\n<!-- ipc:begin thresholds -->\n<!-- ipc:end thresholds -->\n")
    const errors: string[] = []
    await run(
      [],
      dir,
      { out: () => {}, err: (t) => errors.push(t) },
      {
        formatOptions: () => Promise.resolve({}),
        standardRoot: dir,
      },
    )
    expect(errors.join("")).toContain(
      'checks/strict.ts not found; the "thresholds" region reads COVERAGE_THRESHOLDS from it.',
    )
  })
})
