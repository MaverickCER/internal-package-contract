// internal-package-contract benchmark suite: the evidence collectors the checks run (the scripts under
// `scripts/` that every `check-*.mjs` shell calls) and the shared runtime modules (`runtime/`) that
// consumers carry as managed copies. These are development and CI costs: the scans run once per contract
// run over the consumer's repository, the runtime modules run inside a consumer's build tooling.
// See ../READING-BENCHMARKS.md and ../WRITING-BENCHMARKS.md.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { register } from "tsx/esm/api"
import { defineSuite } from "../../scripts/benchmark/kit/index.mjs"
import { scanRepository } from "../../scripts/suppressions-scan.mjs"
import { findPrompts, scanPackage } from "../../scripts/prompts/scan.mjs"
import { validateReadme } from "../../scripts/readme/validate.mjs"
import { checkPins } from "../../scripts/pin-consistency.mjs"
import { judgeEngineMatrix } from "../../scripts/engines/validate.mjs"
import { validateScorecardWorkflows } from "../../scripts/scorecard/validate.mjs"
import { resolvePages } from "../../scripts/accessibility-pages.mjs"
import { inspectManaged } from "../../scripts/managed-files/inspect.mjs"
import { readAdoption } from "../../scripts/adoption/mode.mjs"
import { rulesetCoversBranch } from "../../scripts/github-repo.mjs"
import { linkinatorArgs } from "../../scripts/docs-links-args.mjs"
import { complexityGains } from "../../scripts/benchmark/complexity-gain.mjs"
import { findRegions, replaceRegions } from "../../scripts/generate/regions.mjs"
import { entryPointRows } from "../../scripts/generate/entry-points.mjs"

register()
const glob = await import("../../runtime/glob.ts")
const display = await import("../../runtime/display-path.ts")
const bannerModule = await import("../../runtime/generated-banner.ts")
const tsconfigPaths = await import("../../runtime/resolve-tsconfig-paths.ts")
const noNodeFs = await import("../../runtime/no-node-fs.ts")
const compilerApi = await import("../../runtime/compiler-api.ts")
const typescriptModule = await import("../../runtime/typescript.ts")

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const ts = createRequire(import.meta.url)("typescript")
const SLOW = { warmupIterations: 1, minIterations: 3, maxIterations: 8, targetDurationMs: 1000 }
const scratch = mkdtempSync(path.join(tmpdir(), "ipc-bench-"))
const made = new Map()

/** A fixture is written once per (kind, size) and shared by every sample. */
function fixture(kind, n, write) {
  const key = `${kind}-${String(n)}`
  if (!made.has(key)) {
    const dir = path.join(scratch, key)
    mkdirSync(dir, { recursive: true })
    write(dir, n)
    made.set(key, dir)
  }
  return made.get(key)
}
function put(dir, file, text) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), text)
}
const index = (i) => String(i).padStart(5, "0")

function writeRepo(dir, n) {
  put(dir, "package.json", "{}")
  for (let i = 0; i < n; i += 1) {
    put(
      dir,
      `src/file-${index(i)}.ts`,
      `// eslint-disable-next-line no-console -- the reason this line may log, long enough to count\nexport const value${String(i)} = (): void => { console.log(${String(i)}) }\n`,
    )
  }
}
function writePrompts(dir, n) {
  put(dir, "package.json", "{}")
  for (let i = 0; i < n; i += 1) {
    put(
      dir,
      `specs/decisions/${index(i)}-decision.md`,
      `# Decision ${String(i)}\n\n<!-- ipc:prompt: say why -->\n\nBody.\n`,
    )
  }
}
function writePages(dir, n) {
  for (let i = 0; i < n; i += 1)
    put(dir, `page-${index(i)}.html`, "<!doctype html><title>x</title>")
}

function writePathsProject(dir, n) {
  put(dir, "src/module.ts", "export const value = 1\n")
  const paths = Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`@a${String(i)}/*`, ["./src/*"]]),
  )
  put(dir, "tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths } }))
}
const memoryBuildFs = {
  readFile: () => Promise.resolve(""),
  writeFile: () => Promise.resolve(),
  mkdir: () => Promise.resolve(),
  readdir: () => Promise.resolve([]),
  stat: () => Promise.resolve({ isFile: () => true, size: 1 }),
  realpath: (p) => Promise.resolve(p),
}
const regionText = (n) =>
  Array.from(
    { length: n },
    (_, i) =>
      `text ${String(i)}\n<!-- ipc:begin r${String(i)} -->\nold\n<!-- ipc:end r${String(i)} -->\n`,
  ).join("\n")

const workflow = (i) =>
  `name: w${String(i)}\non:\n  schedule:\n    - cron: "0 0 * * 0"\njobs:\n  test:\n    strategy:\n      matrix:\n        node-version: [18, 20, 22]\n    steps:\n      - uses: MaverickCER/internal-package-contract/.github/workflows/x.yml@${"a".repeat(40)} # v0.1.0\n`
const scorecard = (i) =>
  `name: s${String(i)}\non:\n  schedule:\n    - cron: "0 0 * * 0"\npermissions:\n  id-token: write\njobs:\n  s:\n    steps:\n      - uses: ossf/scorecard-action@${"b".repeat(40)}\n        with:\n          publish_results: true\n`

const UNIT = (what) => ({
  name: what,
  how: "swept",
  description: `The tier axis: how many ${what} the input holds.`,
})
const DISK = {
  name: "filesystem",
  how: "fixed",
  value: "local SSD",
  description: "A network or virtual filesystem adds latency per file; not covered.",
}
const RUNTIME = {
  name: "runtime",
  how: "fixed",
  value: "Node (V8)",
  description: "Measured on Node only.",
}
const SHAPE = (value) => ({
  name: "input shape",
  how: "fixed",
  value,
  description:
    "Unusual shapes (very long lines, deep nesting) change the constant, not the growth class.",
})

const POOR_SCAN =
  "Every contract run, pre-commit hook and pull request check would wait longer for the same verdict, in proportion to the size of the repository being checked."

function fn(spec) {
  return {
    poorPerformanceMeans: POOR_SCAN,
    sampling: SLOW,
    inEndToEnd: {
      callsPerOperation: 1,
      description: "Once per contract run that includes the check.",
    },
    variables: [UNIT(spec.unit), SHAPE(spec.shape), ...(spec.disk ? [DISK] : []), RUNTIME],
    ...Object.fromEntries(
      Object.entries(spec).filter(([key]) => !["unit", "shape", "disk"].includes(key)),
    ),
  }
}

export default defineSuite({
  package: { name: "internal-package-contract" },
  workload: {
    unit: "item",
    description:
      "One file, line, workflow or pattern segment, depending on the function (each function says which). 640 items is a large repository's worth of the thing being scanned.",
    typicalN: 640,
  },
  endToEnd: {
    purpose:
      "Shows what the suppression evidence collector costs a repository: scanning every source file for suppression comments, against the floor of just reading every file. The difference is the parsing the check needs to tell a real directive from text that only looks like one.",
    baseline: {
      description: "Read every file of the repository as text -- no package.",
      sampling: SLOW,
      setup: (n) => ({ dir: path.join(fixture("repo", n, writeRepo), "src") }),
      run: ({ dir }) =>
        readdirSync(dir).reduce(
          (bytes, name) => bytes + readFileSync(path.join(dir, name), "utf8").length,
          0,
        ),
    },
    withPackage: {
      description: "`scanRepository` finds every suppression directive in every file.",
      sampling: SLOW,
      setup: (n) => ({ dir: fixture("repo", n, writeRepo) }),
      run: ({ dir }) => scanRepository(dir, ts),
    },
    variables: [
      UNIT("source files"),
      SHAPE("one TypeScript file with one documented suppression"),
      DISK,
      RUNTIME,
    ],
  },
  functions: [
    fn({
      id: "scan-repository",
      name: "scanRepository",
      why: "Runs once per contract run to govern every suppression comment in the repository, so it is the most expensive evidence collector on a large codebase.",
      expectedComplexity: "linear",
      complexityReason: "It lists the files once, then reads and parses each exactly once.",
      unit: "source files",
      shape: "one short TypeScript file with one suppression",
      disk: true,
      setup: (n) => ({ dir: fixture("repo", n, writeRepo) }),
      run: ({ dir }) => scanRepository(dir, ts),
    }),
    fn({
      id: "scan-package-prompts",
      name: "scanPackage",
      why: "Runs at release time and on every contract run to find prompts a maintainer has not answered yet.",
      expectedComplexity: "linear",
      complexityReason: "It reads each document and decision record once and scans its lines.",
      unit: "decision records",
      shape: "one short record with one prompt",
      disk: true,
      setup: (n) => ({ dir: fixture("prompts", n, writePrompts) }),
      run: ({ dir }) => scanPackage(dir),
    }),
    fn({
      id: "find-prompts",
      name: "findPrompts",
      why: "The line scanner under `scanPackage`; every document passes through it.",
      expectedComplexity: "linear",
      complexityReason: "It tests each line against one regular expression.",
      unit: "lines",
      shape: "one prompt every ten lines",
      setup: (n) => ({
        text: Array.from({ length: n }, (_, i) =>
          i % 10 === 0 ? "<!-- ipc:prompt: x -->" : "text",
        ).join("\n"),
      }),
      run: ({ text }) => findPrompts(text),
    }),
    fn({
      id: "validate-readme",
      name: "validateReadme",
      why: "Judges the layout of the README on every contract run.",
      expectedComplexity: "linear",
      complexityReason:
        "It splits the README into lines and visits each once to find the headings.",
      unit: "lines",
      shape: "one title, no standard sections, body text",
      setup: (n) => ({ text: ["# name", ...Array.from({ length: n }, () => "text")].join("\n") }),
      run: ({ text }) => validateReadme(text),
    }),
    fn({
      id: "check-pins",
      name: "checkPins",
      why: "Compares the installed checks with every workflow that calls them, on every contract run in a consumer.",
      expectedComplexity: "linear",
      complexityReason: "It finds the pins in each workflow with one pass over its text.",
      unit: "workflow files",
      shape: "one pinned reusable workflow per file",
      setup: (n) => ({
        input: {
          packageJson: JSON.stringify({
            devDependencies: {
              "internal-package-contract": `github:MaverickCER/internal-package-contract#${"a".repeat(40)}`,
            },
          }),
          lockfile: "",
          workflows: Array.from({ length: n }, (_, i) => ({
            file: `w${String(i)}.yml`,
            text: workflow(i),
          })),
        },
      }),
      run: ({ input }) => checkPins(input),
    }),
    fn({
      id: "judge-engine-matrix",
      name: "judgeEngineMatrix",
      why: "Decides whether the declared Node range is exercised by CI, on every contract run.",
      expectedComplexity: "linear",
      complexityReason: "It reads the tested versions out of each workflow and merges them.",
      unit: "workflow files",
      shape: "one three-version matrix per file",
      setup: (n) => ({ workflows: Array.from({ length: n }, (_, i) => workflow(i)) }),
      run: ({ workflows }) => judgeEngineMatrix({ engines: { node: ">=18" } }, workflows),
    }),
    fn({
      id: "validate-scorecard-workflows",
      name: "validateScorecardWorkflows",
      why: "Checks the Scorecard workflow publishes its result, on every contract run.",
      expectedComplexity: "linear",
      complexityReason: "It cleans and tests the lines of each workflow once.",
      unit: "workflow files",
      shape: "a correct Scorecard workflow per file",
      setup: (n) => ({
        workflows: Array.from({ length: n }, (_, i) => ({
          name: `s${String(i)}.yml`,
          text: scorecard(i),
        })),
      }),
      run: ({ workflows }) => validateScorecardWorkflows(workflows),
    }),
    fn({
      id: "resolve-pages",
      name: "resolvePages",
      why: "Finds the pages the accessibility scan will open, before the slow part starts.",
      expectedComplexity: "linear",
      complexityReason: "It lists the docs folder once and tests each entry.",
      unit: "pages",
      shape: "flat folder of HTML pages",
      disk: true,
      setup: (n) => ({ dir: fixture("pages", n, writePages) }),
      run: ({ dir }) => resolvePages(dir),
    }),
    fn({
      id: "inspect-managed",
      name: "inspectManaged",
      why: "Compares every file this package owns in a consumer with the standard, on every contract run and every `sync`.",
      expectedComplexity: "constant",
      complexityReason:
        "The set of managed files is fixed (a dozen or so); the workload size does not change how many are compared.",
      unit: "files in the package (not read)",
      shape: "a package with no managed files yet (all missing)",
      disk: true,
      setup: () => ({ dir: fixture("managed", 0, (d) => put(d, "package.json", '{"name":"x"}')) }),
      run: ({ dir }) =>
        inspectManaged({
          cwd: dir,
          packageRoot,
          pins: { ipcRef: "v0.1.0", ipcSha: "a".repeat(40) },
        }),
    }),
    fn({
      id: "glob-to-regexp",
      name: "globToRegExp",
      why: "Compiles every include and exclude pattern of the build tooling that consumers carry (`runtime/glob.ts`); it runs once per pattern per build.",
      expectedComplexity: "linear",
      complexityReason:
        "It walks the pattern one character at a time and appends to the expression.",
      unit: "pattern segments",
      shape: "alternating `*` and `**` segments",
      setup: (n) => ({
        pattern: Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "a*" : "**")).join("/"),
      }),
      run: ({ pattern }) => glob.globToRegExp(pattern),
    }),
    fn({
      id: "display-path",
      name: "displayPath",
      why: "Formats every path the tooling prints, so it runs once per reported finding.",
      expectedComplexity: "linear",
      complexityReason: "It normalizes and compares the path's characters against the root.",
      unit: "path segments",
      shape: "a path n directories deep under the root",
      setup: (n) => ({ file: `/repo/${Array.from({ length: n }, () => "d").join("/")}/f.ts` }),
      run: ({ file }) => display.displayPath("/repo", file),
    }),
    fn({
      id: "is-generated-file",
      name: "isGeneratedFile",
      why: "Decides for every file a generator is about to overwrite whether it is its own output, so a hand-written file is never clobbered.",
      expectedComplexity: "constant",
      complexityReason:
        "It looks only at the first twenty non-empty lines, so a file of any length costs the same.",
      unit: "lines in the file",
      shape: "a file with no marker, every line non-empty",
      setup: (n) => ({
        content: Array.from(
          { length: n },
          (_, i) => `export const v${String(i)} = ${String(i)}`,
        ).join("\n"),
        banner: bannerModule.createGeneratedBanner(() => ({
          product: "x",
          guideUrl: "https://example.com",
          cliCommand: "npx x",
          reportRegenerateHint: "run the report script",
        })),
      }),
      run: ({ banner, content }) => banner.isGeneratedFile(content),
    }),
    fn({
      id: "read-adoption",
      name: "readAdoption",
      why: "Reads the adoption record on every contract run to decide which failures are advisory.",
      expectedComplexity: "linear",
      complexityReason:
        "It parses one JSON file whose size is proportional to the list of enforced checks.",
      unit: "enforced checks in the record",
      shape: "a valid, unexpired record",
      disk: true,
      setup: (n) => ({
        dir: fixture("adoption", n, (d, count) =>
          put(
            d,
            ".repo-contract/adoption.json",
            JSON.stringify({
              version: 1,
              startedAt: "2026-01-01",
              expiresAt: "2999-01-01",
              enforce: Array.from({ length: count }, (_, i) => `Check${String(i)}`),
            }),
          ),
        ),
      }),
      run: ({ dir }) => readAdoption(dir),
    }),
    fn({
      id: "ruleset-covers-branch",
      name: "rulesetCoversBranch",
      why: "Decides whether a repository's ruleset guards the default branch, once per ruleset the BranchProtection check reads.",
      expectedComplexity: "linear",
      complexityReason:
        "It tests the ruleset's included references against the three names that cover the branch.",
      unit: "included references",
      shape: "references that do not match",
      setup: (n) => ({
        ruleset: {
          conditions: {
            ref_name: { include: Array.from({ length: n }, (_, i) => `refs/heads/b${String(i)}`) },
          },
        },
      }),
      run: ({ ruleset }) => rulesetCoversBranch(ruleset, "main"),
    }),
    fn({
      id: "linkinator-args",
      name: "linkinatorArgs",
      why: "Builds the link checker's command line once per DocsLinks run.",
      expectedComplexity: "constant",
      complexityReason: "It assembles a fixed list of arguments from a few options.",
      unit: "documents (not read)",
      shape: "the default crawl",
      setup: () => ({}),
      run: () => linkinatorArgs(["README.md", "--recurse", "--markdown"]),
    }),
    fn({
      id: "complexity-gains",
      name: "complexityGains",
      why: "Compares every benchmark group's measured growth with the last release's, on every contract run that has benchmark results.",
      expectedComplexity: "constant",
      complexityReason:
        "Its input is one suite's results, whose group count is fixed by the suite and not by the size of the repository.",
      unit: "suites (the committed results of this package are the input)",
      shape: "this package's own committed results, compared with themselves",
      disk: true,
      setup: () => {
        const results = JSON.parse(
          readFileSync(
            path.join(packageRoot, "benchmarks/performance-checks/results.json"),
            "utf8",
          ),
        )
        return { results }
      },
      run: ({ results }) => complexityGains("performance-checks", results, results),
    }),
    fn({
      id: "find-regions",
      name: "findRegions",
      why: "Finds every generated region in a document, for each document `generate` and the GeneratedRegions check read.",
      expectedComplexity: "linear",
      complexityReason: "It reads each line once and matches it against the begin and end markers.",
      unit: "regions in the document",
      shape: "a region every four lines",
      setup: (n) => ({ text: regionText(n) }),
      run: ({ text }) => findRegions(text),
    }),
    fn({
      id: "replace-regions",
      name: "replaceRegions",
      why: "Rewrites every generated region of a document in one pass when `generate` runs.",
      expectedComplexity: "linear",
      complexityReason: "It copies the text between regions once and renders each region once.",
      unit: "regions in the document",
      shape: "a region every four lines",
      setup: (n) => {
        const text = regionText(n)
        return { text, regions: findRegions(text).regions }
      },
      run: ({ text, regions }) => replaceRegions(text, regions, (name) => `new ${name}`),
    }),
    fn({
      id: "entry-point-rows",
      name: "entryPointRows",
      why: "Builds the entry-point table of a package's documents from its exports and surface file, on every `generate`.",
      expectedComplexity: "linear",
      complexityReason: "It visits each published entry once and looks its description up.",
      unit: "published entry points",
      shape: "every entry documented",
      setup: (n) => ({
        pkg: {
          name: "p",
          exports: Object.fromEntries(
            Array.from({ length: n }, (_, i) => [`./e${String(i)}`, `./dist/e${String(i)}.js`]),
          ),
        },
        surface: {
          entries: Object.fromEntries(
            Array.from({ length: n }, (_, i) => [
              `./e${String(i)}`,
              {
                source: "src/e.ts",
                environment: "any",
                tier: "Stable",
                purpose: "does a thing for the person reading this",
              },
            ]),
          ),
        },
      }),
      run: ({ pkg, surface }) => entryPointRows(pkg, surface),
    }),
    fn({
      id: "load-tsconfig-paths",
      name: "loadTsconfigPaths",
      why: "Reads a consumer's tsconfig once per build-time scan, so every package that scans source pays it.",
      expectedComplexity: "linear",
      complexityReason:
        "It parses one configuration file whose size grows with its list of path mappings.",
      unit: "path mappings in the tsconfig",
      shape: "wildcard mappings to one folder",
      disk: true,
      setup: (n) => ({ dir: fixture("paths", n, writePathsProject) }),
      run: ({ dir }) => tsconfigPaths.loadTsconfigPaths("bench", dir, undefined, memoryBuildFs),
    }),
    fn({
      id: "resolve-alias-import",
      name: "resolveAliasImport",
      why: "Resolves every aliased import a scan meets, so it runs once per distinct import in the scanned source.",
      expectedComplexity: "linear",
      complexityReason:
        "TypeScript's resolver tests the specifier against each path mapping in turn.",
      unit: "path mappings in the tsconfig",
      shape: "the last mapping matches; an uncached import",
      disk: true,
      setup: async (n) => {
        const dir = fixture("paths", n, writePathsProject)
        const { resolution } = await tsconfigPaths.loadTsconfigPaths(
          "bench",
          dir,
          undefined,
          memoryBuildFs,
        )
        return { dir, resolution, specifier: `@a${String(n - 1)}/module` }
      },
      run: ({ dir, resolution, specifier }) =>
        tsconfigPaths.resolveAliasImport(
          specifier,
          path.join(dir, "src/x.ts"),
          resolution,
          tsconfigPaths.createAliasResolutionCache(),
        ),
    }),
    fn({
      id: "path-mapping-options",
      name: "pathMappingOptions",
      why: "Reads the two settings that decide whether aliases resolve, once per loaded tsconfig.",
      expectedComplexity: "constant",
      complexityReason: "It picks two fields off the options object.",
      unit: "path mappings (not visited)",
      shape: "options with many mappings",
      setup: (n) => ({
        options: {
          baseUrl: ".",
          paths: Object.fromEntries(
            Array.from({ length: n }, (_, i) => [`@a${String(i)}/*`, ["./src/*"]]),
          ),
        },
      }),
      run: ({ options }) => tsconfigPaths.pathMappingOptions(options),
    }),
    fn({
      id: "no-node-fs-rule",
      name: "createNoNodeFs (the lint rule)",
      why: "Runs on every import of every file the linter visits in a package that carries the rule.",
      expectedComplexity: "linear",
      complexityReason:
        "The rule inspects each import declaration once and tests its specifier against one expression.",
      unit: "import declarations in the file",
      shape: "imports that are not of node:fs",
      setup: (n) => {
        const rule = noNodeFs.createNoNodeFs({
          docsUrl: (name) => `https://example.com/${name}`,
          adr: "ADR",
          guide: "GUIDE",
        })
        const visitor = rule.create(
          { filename: "/repo/src/a.ts", options: [{ allow: [] }], report: () => undefined },
          [{ allow: [] }],
        )
        return {
          visit: visitor.ImportDeclaration,
          nodes: Array.from({ length: n }, (_, i) => ({ source: { value: `./m${String(i)}.js` } })),
        }
      },
      run: ({ visit, nodes }) => {
        for (const node of nodes) visit(node)
        return nodes.length
      },
    }),
    fn({
      id: "pick-compiler",
      name: "pickCompiler",
      why: "Chooses the TypeScript compiler a scanner parses with, once at import.",
      expectedComplexity: "constant",
      complexityReason: "It tries at most two module ids and tests each for the classic API.",
      unit: "modules loaded (not scaled)",
      shape: "the consumer's compiler has the classic API",
      setup: () => ({ load: () => ({ createSourceFile: () => undefined }) }),
      run: ({ load }) => typescriptModule.pickCompiler(load),
    }),
    fn({
      id: "assert-compiler-api",
      name: "assertCompilerApi",
      why: "Guards every scanner entry point against a compiler that lacks the classic API.",
      expectedComplexity: "constant",
      complexityReason: "It tests one property of the compiler module.",
      unit: "calls (not scaled)",
      shape: "a compiler with the API",
      setup: () => ({ compiler: { createSourceFile: () => undefined } }),
      run: ({ compiler }) => compilerApi.assertCompilerApi("bench", compiler),
    }),
    fn({
      id: "absolute-path-from",
      name: "absolutePathFrom",
      why: "Turns a reported path back into an absolute one for the tooling that opens it.",
      expectedComplexity: "linear",
      complexityReason: "It resolves the path against the root, which reads each segment once.",
      unit: "path segments",
      shape: "a relative path n directories deep",
      setup: (n) => ({ file: `${Array.from({ length: n }, () => "d").join("/")}/f.ts` }),
      run: ({ file }) => display.absolutePathFrom("/repo", file),
    }),
    fn({
      id: "banner-text",
      name: "generatedBanner, evidenceDisclaimer and evidenceProjectionNote",
      why: "Render the text every generated file carries, once per generated file.",
      expectedComplexity: "constant",
      complexityReason:
        "They build a few strings from fixed options; the size of the generated file never enters.",
      unit: "generated files (one banner each)",
      shape: "the options of a typical package",
      setup: () => ({
        banner: bannerModule.createGeneratedBanner(() => ({
          product: "x",
          guideUrl: "https://example.com",
          cliCommand: "npx x",
          reportRegenerateHint: "run the report script",
        })),
      }),
      run: ({ banner }) => [
        banner.generatedBanner("ts"),
        banner.evidenceDisclaimer(),
        banner.evidenceProjectionNote("e.json"),
        banner.reportRegenerateHint(),
      ],
    }),
  ],
})
