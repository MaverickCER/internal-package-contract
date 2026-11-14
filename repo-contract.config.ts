/**
 * This package's own self-contract, run by `npm run contract` (`scripts/run-contract.mjs`). Each check
 * runs its real `run` and `policy`, the same way a consumer such as env-cap or data-cap runs it.
 *
 * It is separate from `contract.ts`, which is the product: the contract a consumer runs against its
 * own tree. This package ships raw `.ts` source with no `dist/` and no build script (`package.json`
 * `exports` point at `.ts` files). `Build`, `Packaging` and `TypeResolution` would be vacuous or
 * wrong here, so they are not declared.
 *
 * Unlike `contract.ts`, it has no writer phase and no `Build` barrier. Every check here only reads,
 * including `Lint` (`--format json`) and `Format` (`--check .`), which run the same way in
 * `contract.ts`. So no check can race a rewrite. `Coverage` and `Crap` still `dependsOn` `Tests`, because they read
 * the artifacts `Tests` writes.
 *
 * What this file declares beyond the shared checks:
 * - `SurfaceContract`: this package's CLI help, exit codes, schemas and `action.yml` against the
 *   baseline of the last release.
 * - `CodeScanning`: the open CodeQL alerts of this ref. Default setup is enabled on the repository.
 * - `EnvContract`: `ci/env.schema.ts`.
 * - `GitHooks`: a clone that runs the hooks. Not judged in CI.
 * - `GeneratedRegions`: the README's `supported-versions` region against `package.json`.
 *
 * What it leaves out of `standardChecks()`, and why (every omission, so nothing is missing by accident):
 * - `Build`, `Packaging`, `TypeResolution`, `NoMinify`, `DistNoUrls`, `Size`, `PackedConsumer`: this package
 *   has no `dist/`, no build, and is never packed for npm (consumers install it from git).
 * - `ApiContract`, `ApiDocs`, `ApiDocsReport`, `Schema`, `ReadmeExample`: consumers import this package's raw
 *   TypeScript by path (`checks/*`, `./benchmark` and the other exports), and there is no build that emits the
 *   declarations API Extractor reads. Those exports are not diffed; README "Stability" says review decides. The
 *   CLI surface is what `SurfaceContract` guards.
 * - `ReadmeStructure`, `LandingPage`, `Accessibility`, `ScorecardWorkflow`, `EngineMatrix`: for published
 *   packages; this one is private (`"private": true`), so each would pass vacuously.
 * - `PinConsistency`, `ManagedFiles`: judge a consumer's pin of this package and the files it manages there;
 *   this repository is the source of both, not a consumer, so each would pass vacuously.
 * - `BenchmarkCoverage`, `BenchmarkComplexity`, `BenchmarkGuides`: the suites under `benchmarks/` are committed,
 *   but their `results.json` is not (`npm run benchmark` writes it; README, "Benchmarks"), and the guides here are
 *   the canonical copies the check compares consumers against.
 * - `AdoptionMode`, `PromptBlocks`: this package is not adopting its own standard and has no scaffold prompts;
 *   each would pass vacuously.
 * - `CodeRabbit`: the review bot is configured per consumer repository, not here.
 *
 * This repository has no `src/`: its real code lives in `checks/`, `scripts/` and `bin/` (the scope
 * in `scope.mjs`, mirrored by `vitest.config.ts`'s coverage scope and `stryker.config.mjs`'s `mutate`).
 * `Architecture`, `Crap` and `Duplication` each pass `"src"` as the scan path in their `run`. The
 * `...OverScope` helpers below retarget them at those trees, minus the process entry points
 * `scope.mjs` names. That is the `run` override `contract.ts` documents for a consumer that differs
 * from a preset's default.
 *
 * `Mutation` is `isolated: true` and declared last, as in `contract.ts`. Stryker spawns its own
 * worker pool, and every other reader has finished before it starts. That includes `Lint`, which
 * could otherwise scan Stryker's `.stryker-tmp/` sandbox copy mid-run.
 */
import crossSpawn, { sync as crossSpawnSync } from "cross-spawn"
import { defineRepoContract } from "repo-contract"
import type { CheckDefinitionConfig } from "repo-contract"
import { format, license, lint, typecheck } from "repo-contract/presets"
import { ENTRY_SHELLS, NON_RUNTIME, SCOPE_DIRS } from "./scope.mjs"
import { architecture } from "./checks/architecture.js"
import { createBranchProtection } from "./checks/branch-protection.js"
import { commits } from "./checks/commits.js"
import { coverage } from "./checks/coverage.js"
import { crap } from "./checks/crap.js"
import { deadCode } from "./checks/dead-code.js"
import { duplication } from "./checks/duplication.js"
import { docsFragments } from "./checks/docs-fragments.js"
import { proseCheck } from "./checks/prose.js"
import { docsLinks } from "./checks/docs-links.js"
import { docsMarkdown } from "./checks/docs-markdown.js"
import { cleanCheckoutCheck } from "./checks/clean-checkout.js"
import { codeScanning } from "./checks/code-scanning.js"
import { envContractCheck } from "./checks/env-contract.js"
import { generatedRegionsCheck } from "./checks/generated-regions.js"
import { gitHooksCheck } from "./checks/git-hooks.js"
import { surfaceContract } from "./checks/surface-contract.js"
import { gitHygiene } from "./checks/git-hygiene.js"
import { githubActions } from "./checks/github-actions.js"
import { mutation } from "./checks/mutation.js"
import { securityDeps } from "./checks/security-deps.js"
import { securityDevDeps } from "./checks/security-dev-deps.js"
import { securitySecrets } from "./checks/security-secrets.js"
import { securitySocket } from "./checks/security-socket.js"
import { suppressions } from "./checks/suppressions.js"
import { tests } from "./checks/tests.js"

/** A check's `run` array, which every check here writes as `[tool, "src", ...flags]`; `[tool, ...flags]` is what is left after the scan path. */
function flagsOf(check: CheckDefinitionConfig): string[] {
  return (check.run as readonly string[]).slice(2)
}

/** Retargets `crap4ts` from the consumer's `src/` at this repository's own trees, leaving out the entry shells (see scope.mjs). */
function crapOverScope(check: CheckDefinitionConfig): CheckDefinitionConfig {
  return {
    ...check,
    run: [
      "crap4ts",
      ...SCOPE_DIRS,
      ...[...NON_RUNTIME, ...ENTRY_SHELLS].flatMap((glob) => ["--ignore", glob]),
      ...flagsOf(check),
    ],
  }
}

/** Retargets `jscpd`, which takes the ignore globs as one comma-separated option. */
function duplicationOverScope(check: CheckDefinitionConfig): CheckDefinitionConfig {
  return {
    ...check,
    run: [
      "jscpd",
      ...SCOPE_DIRS,
      "--ignore",
      [...NON_RUNTIME, ...ENTRY_SHELLS].join(","),
      ...flagsOf(check),
    ],
  }
}

/** Retargets `depcruise`. */
function architectureOverScope(check: CheckDefinitionConfig): CheckDefinitionConfig {
  return { ...check, run: ["depcruise", ...SCOPE_DIRS, ...flagsOf(check)] }
}

export default defineRepoContract({
  spawn: crossSpawn,
  env: process.env,
  killProcessTree: crossSpawnSync,
  checks: {
    Lint: lint(),
    Format: { ...format, run: ["prettier", "--check", "."] },
    Typecheck: { ...typecheck, run: ["tsc", "--noEmit", "-p", "tsconfig.self.json"] },
    // `isolated`: the single heaviest check (Vitest with V8 coverage
    // instrumentation), same reasoning as `contract.ts`'s own `Tests`.
    Tests: { ...tests(), isolated: true },
    Architecture: architectureOverScope(architecture()),
    GithubActions: githubActions,
    GitHygiene: gitHygiene,
    CleanCheckout: cleanCheckoutCheck(),
    BranchProtection: createBranchProtection(),
    Coverage: { ...coverage, dependsOn: ["Tests"] },
    Crap: { ...crapOverScope(crap), dependsOn: ["Coverage"] },
    Duplication: duplicationOverScope(duplication),
    // The preset reads this repo's `.licensee.json` (OSI-approved plus Blue Oak Gold and a short
    // allow-list of public-domain or attribution-only licenses its tooling dependencies carry).
    Licenses: license,
    DocsMarkdown: docsMarkdown(),
    DocsLinks: docsLinks,
    DocsFragments: docsFragments,
    GeneratedRegions: generatedRegionsCheck(),
    Prose: proseCheck(),
    // Same reviewed-exceptions filter contract.ts's own SecurityDeps uses (see
    // checks/security-deps.ts): dogfooded here rather than duplicated.
    SecurityDeps: securityDeps(),
    SecurityDevDeps: securityDevDeps(),
    SecuritySecrets: securitySecrets(),
    SecuritySocket: securitySocket(),
    Suppressions: suppressions(),
    DeadCode: deadCode(),
    Commits: commits(),
    SurfaceContract: surfaceContract(),
    CodeScanning: codeScanning(),
    EnvContract: envContractCheck(),
    GitHooks: gitHooksCheck(),
    Mutation: { ...mutation(), isolated: true },
  },
})
