/**
 * IPC's hardening of repo-contract's `strict` tier: the limits the standard holds every package to,
 * and the options where IPC's run differs from a plain `strict()`. Those are `Build`, `Duplication`,
 * `TypeResolution`, `Crap`, `DocsMarkdown` and `Mutation`; `strictOverrides` gives each one's reason.
 *
 * The limits travel as `strict()` overrides, never as replaced checks. The tier metadata then states
 * them, so `repo-contract explain` and the report's "Compared with the standard" section judge the real settings.
 * Coverage holds 80% on every metric, CRAP 30 and complexity 20, and duplication 0.75% of `src/`.
 * Mutation holds 100%: every mutant is detected or covered by a record in
 * `.repo-contract/exceptions/mutation.json`.
 *
 * repo-contract source never reads the environment (its ADR 0011), so this module maps IPC's
 * variables onto the Mutation preset's options when the contract loads. `IPC_MUTATION_REPORT` names
 * a report to judge instead of mutating, and wins over `IPC_MUTATION_SHARD`. `IPC_MUTATION_SHARD`
 * mutates one slice `i/n`. A clean run is reused locally and never under `CI` or with
 * `IPC_MUTATION_MEMO=0`. A package without its own Stryker config gets the bundled one.
 *
 * `--scope affected` is IPC's runner, so the scope wrappers live here too. Coverage warns without
 * judging a narrowed run. Crap judges only the functions in the affected sources, and fails rather
 * than rewrite a report reached through a symbolic link. The runner itself narrows Mutation's
 * `mutate` list (scripts/affected-scope.mjs).
 */
import { lstatSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyContext, PolicyResult } from "repo-contract"
import type { MutationOptions } from "repo-contract/presets"
import { strict } from "repo-contract/tiers"
import type { StrictCheckId, TierConfig, TierOverrides } from "repo-contract/tiers"
import { narrowedScope } from "./scope.js"
import { bundledConfig, firstExisting, resolveConfig } from "./shared.js"

/** The minimum aggregate coverage every publishable package must hold, per metric. */
export const COVERAGE_THRESHOLDS = {
  lines: 80,
  statements: 80,
  functions: 80,
  branches: 80,
} as const
/** CRAP ceiling. Above this a function is too risky for its coverage. */
export const CRAP_THRESHOLD = 30
/** Raw cyclomatic-complexity ceiling: CRAP collapses toward plain complexity as coverage approaches 100%, so this keeps pressure on a fully covered but deeply branching function. */
export const MAX_COMPLEXITY = 20
/** Maximum share of `src/` that may be duplicated code. */
export const DUPLICATION_MAX_PERCENTAGE = 0.75
/** Every mutant is detected, or a hand-verified record covers it. */
export const MUTATION_MIN_SCORE = 100

/**
 * The names of a package's own Stryker config, in repo-contract's `mutation run` order. The reusable
 * workflow's `plan` job loops over the same list, so both mutate under the same config.
 */
export const STRYKER_CONFIGS = [
  "stryker.config.mjs",
  "stryker.config.js",
  "stryker.config.cjs",
  "stryker.config.json",
  "stryker.conf.mjs",
  "stryker.conf.js",
  "stryker.conf.cjs",
  "stryker.conf.json",
  ".stryker.conf.json",
] as const

/** A package's own markdownlint config also owns its rules; the bundled one applies only without it. */
const MARKDOWNLINT_CONFIGS = [
  ".markdownlint-cli2.jsonc",
  ".markdownlint-cli2.yaml",
  ".markdownlint-cli2.cjs",
  ".markdownlint-cli2.mjs",
  ".markdownlint-cli2.json",
  ".markdownlint.jsonc",
  ".markdownlint.json",
  ".markdownlint.yaml",
]

/** Where crap4ts writes its report, repo-contract's default. */
const CRAP_REPORT = path.join("reports", "crap.json")

type Environment = Readonly<Record<string, string | undefined>>

/**
 * @param value - an environment variable.
 * @returns the value trimmed, or `undefined` when it is unset or blank.
 */
function setting(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? undefined : trimmed
}

/**
 * The Mutation preset's options for this run, read from IPC's variables. Evaluated when the
 * contract loads, with the package as the working directory.
 * @param env - the process environment.
 * @returns the options IPC passes to repo-contract's `mutation` preset.
 */
export function mutationOptions(env: Environment): MutationOptions {
  const report = setting(env["IPC_MUTATION_REPORT"])
  // A job that judges a report mutates nothing, whatever shard it inherits; repo-contract also refuses the pair.
  const shard = report === undefined ? setting(env["IPC_MUTATION_SHARD"]) : undefined
  const ci = env["CI"]
  const inCi = ci !== undefined && ci !== "" && ci !== "false"
  const cache = inCi || env["IPC_MUTATION_MEMO"] === "0" ? "off" : "read-write"
  const ownConfig = firstExisting(STRYKER_CONFIGS) !== undefined
  return {
    minScore: MUTATION_MIN_SCORE,
    ...(shard === undefined ? {} : { shard }),
    ...(report === undefined ? {} : { report }),
    cache,
    ...(ownConfig ? {} : { config: bundledConfig("stryker.config.mjs") }),
  }
}

/**
 * IPC's options for repo-contract's `strict` tier. Every numeric limit is at least as strict as the
 * tier's. `Build` fails a package with no build script, which the tier skips. Three options narrow
 * what is judged instead. `Duplication` scans `src/`, where the tier scans the whole repository.
 * `TypeResolution` ignores the `node10` resolver, which the tier judges. `Crap` ignores the managed
 * `_ipc/` copies, which are tested here.
 * @param env - the process environment.
 * @returns the overrides `strict()` receives.
 */
export function strictOverrides(env: Environment): TierOverrides {
  const markdownlint = resolveConfig(MARKDOWNLINT_CONFIGS, "markdownlint.jsonc")
  return {
    // Fails when the package has no build script: every reader after it needs a fresh `dist/`.
    Build: { script: "build", label: "Build", whenMissing: "fail" },
    Duplication: { path: "src", maxPercentage: DUPLICATION_MAX_PERCENTAGE },
    Coverage: { thresholds: COVERAGE_THRESHOLDS },
    // A package with modern `exports` does not serve the pre-`exports` resolver.
    TypeResolution: { ignoreResolutions: ["node10"] },
    Crap: {
      threshold: CRAP_THRESHOLD,
      maxComplexity: MAX_COMPLEXITY,
      // Managed copies of IPC's runtime modules are covered and mutation-tested here, not in the
      // consumer. The leading `**/` matters: crap4ts does not match `src/_ipc/**` against `src` paths.
      ignore: ["**/_ipc/**"],
    },
    // Explicit globs keep markdownlint out of node_modules, where a `**` glob runs out of memory.
    DocsMarkdown: {
      globs: ["*.md", "docs/**/*.md"],
      verdict: "exit-code",
      ...(markdownlint.isBundled ? { config: markdownlint.path } : {}),
    },
    Mutation: mutationOptions(env),
  }
}

/**
 * repo-contract's `strict` tier with IPC's hardening.
 * @param env - the process environment.
 * @returns the tier's checks and its metadata.
 */
export function standardTier(env: Environment = process.env): TierConfig<StrictCheckId> {
  return strict(strictOverrides(env))
}

/**
 * repo-contract's Coverage, which warns without judging a run narrowed to what a change affects.
 * @param check - the tier's Coverage check.
 * @returns the same check, scope-aware.
 */
export function coverageInScope(check: CheckDefinitionConfig): CheckDefinitionConfig {
  return {
    ...check,
    policy: (ctx: PolicyContext): PolicyResult | Promise<PolicyResult> => {
      const narrowed = narrowedScope(ctx)
      if (narrowed === undefined) return check.policy(ctx)
      return {
        outcome: "warn",
        rationale: `Coverage: not evaluated: this run covers the ${String(narrowed.tests.length)} test file(s) a change affects, so the package-wide aggregate would say nothing about the package; a full run checks it.`,
      }
    },
  }
}

/**
 * @param file - a path crap4ts reported, relative to the working directory or absolute.
 * @returns the same file relative to the repository, with forward slashes.
 */
function repoRelative(file: string): string {
  return path.relative(process.cwd(), path.resolve(process.cwd(), file)).split(path.sep).join("/")
}

/**
 * @param report - a path relative to the working directory.
 * @returns the first part of it, from the top, that is a symbolic link; `undefined` when none is.
 */
function linkOnPath(report: string): string | undefined {
  const parts = report.split(/[\\/]/)
  return parts
    .map((_, index) => parts.slice(0, index + 1).join("/"))
    .find(
      (partial) =>
        lstatSync(path.join(process.cwd(), partial), {
          throwIfNoEntry: false,
        })?.isSymbolicLink() === true,
    )
}

/**
 * Keeps only the functions in the affected sources in the report crap4ts wrote. A report that is
 * missing or not the expected shape is left for repo-contract's policy to fail.
 * @param report - the crap4ts report, relative to the working directory.
 * @param sources - the affected sources, relative to the repository.
 */
async function narrowReport(report: string, sources: readonly string[]): Promise<void> {
  const file = path.join(process.cwd(), report)
  const value: unknown = await readFile(file)
    .then((bytes) => JSON.parse(String(bytes)) as unknown)
    .catch(() => undefined)
  const functions = (value as { functions?: unknown } | null | undefined)?.functions
  if (!Array.isArray(functions)) return
  const affected = new Set(sources)
  const kept = functions.filter((fn: { file?: unknown }) => {
    return typeof fn.file === "string" && affected.has(repoRelative(fn.file))
  })
  await writeFile(file, JSON.stringify({ ...(value as object), functions: kept }))
}

/**
 * repo-contract's Crap, which judges only the affected sources of a narrowed run. A narrowed run
 * executes only the affected tests, so only the files they exercise have coverage worth weighing.
 * @param check - the tier's Crap check.
 * @param report - where it reads the crap4ts report.
 * @returns the same check, scope-aware.
 */
export function crapInScope(
  check: CheckDefinitionConfig,
  report: string = CRAP_REPORT,
): CheckDefinitionConfig {
  return {
    ...check,
    policy: async (ctx: PolicyContext): Promise<PolicyResult> => {
      const narrowed = narrowedScope(ctx)
      if (narrowed === undefined) return check.policy(ctx)
      if (narrowed.tests.length === 0) {
        return {
          outcome: "pass",
          rationale: "CRAP: no test file is affected, so no function was measured.",
        }
      }
      // The report is rewritten in place, and a link would carry that write outside the repository.
      const link = linkOnPath(report)
      if (link !== undefined) {
        return {
          outcome: "fail",
          rationale: `CRAP: ${link} is a symbolic link, so the narrowed report was not written. A link could point outside the repository; delete it and run again.`,
        }
      }
      await narrowReport(report, narrowed.sources)
      return check.policy(ctx)
    },
  }
}
