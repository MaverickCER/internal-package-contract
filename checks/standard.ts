/**
 * The standard: every check a package must keep passing, as one map of check id to definition, in
 * schedule order. `contract.ts` wraps it for a consumer. `repo-contract.config.ts` composes IPC's
 * own self-contract from the same functions, leaving out the checks that need a `dist/` or a
 * published package.
 *
 * It is repo-contract's `strict` tier with IPC's hardening (checks/strict.ts), plus IPC's own
 * checks. A tier check is taken by id, so IPC's limits reach it as options and `explain` reads
 * them. A tier check is replaced only where IPC's behaviour differs: `Tests` (records for skipped
 * tests), `SecuritySecrets`, `DeadCode` and `Commits` (bundled configs), `DistNoUrls` (its
 * registry), `SecurityDeps` (an `info` advisory needs a record too) and `DocsLinks` (unreachable
 * external links are environment degradations).
 *
 * Declaration order is the schedule. First the writers: `ApiDocs`, `ApiDocsReport`,
 * `ReadmeExample`, `Lint`, `Format`, `Schema`. Then the `Build` barrier. Then the readers,
 * concurrent except where `isolated` or `dependsOn` says otherwise, with `Mutation` last. Each
 * check's own header says what it reads and what fails it. Tool configs are resolved when this
 * function runs, with the package as the working directory.
 * @returns A fresh check map, each policy wrapped so a failure leads with the error its tool died
 *   with.
 */
import type { CheckDefinitionConfig } from "repo-contract"
import { npmScript } from "repo-contract/presets"
import type { StrictCheckId } from "repo-contract/tiers"
import { accessibility } from "./accessibility.js"
import { apiContract } from "./api-contract.js"
import { architecture } from "./architecture.js"
import { benchmarkComplexityCheck } from "./benchmark-complexity.js"
import { benchmarkCoverageCheck } from "./benchmark-coverage.js"
import { benchmarkGuides } from "./benchmark-guides.js"
import { typeResolutionCheck } from "./arethetypeswrong.js"
import { branchProtection } from "./branch-protection.js"
import { coderabbitai } from "./coderabbitai.js"
import { commits } from "./commits.js"
import { deadCode } from "./dead-code.js"
import { distNoUrlsCheck } from "./dist-no-urls.js"
import { docsFragments } from "./docs-fragments.js"
import { proseCheck } from "./prose.js"
import { docsLinks } from "./docs-links.js"
import { engineMatrixCheck } from "./engine-matrix.js"
import { packedConsumerCheck } from "./packed-consumer.js"
import { gitHooksCheck } from "./git-hooks.js"
import { adoptionModeCheck } from "./adoption-mode.js"
import { withErrorHeadline } from "./shared.js"
import { envContractCheck } from "./env-contract.js"
import { generatedRegionsCheck } from "./generated-regions.js"
import { promptBlocksCheck } from "./prompt-blocks.js"
import { quickStartCheck } from "./quick-start.js"
import { landingPageCheck } from "./landing-page.js"
import { readmeStructureCheck } from "./readme-structure.js"
import { scorecardWorkflowCheck } from "./scorecard-workflow.js"
import { cleanCheckoutCheck } from "./clean-checkout.js"
import { gitHygiene } from "./git-hygiene.js"
import { githubActions } from "./github-actions.js"
import { managedFilesCheck } from "./managed-files.js"
import { noMinify } from "./no-minify.js"
import { pinConsistency } from "./pin-consistency.js"
import { securityDeps } from "./security-deps.js"
import { securityDevDeps } from "./security-dev-deps.js"
import { securitySecrets } from "./security-secrets.js"
import { coverageInScope, crapInScope, standardTier } from "./strict.js"
import { suppressions } from "./suppressions.js"
import { surfaceContract } from "./surface-contract.js"
import { codeScanning } from "./code-scanning.js"
import { securitySocket } from "./security-socket.js"
import { tests } from "./tests.js"

export function standardChecks() {
  // Typed as plain checks: the tier types `dependsOn` against its own ids, and IPC's set differs.
  const tier: Readonly<Record<StrictCheckId, CheckDefinitionConfig>> = standardTier().checks
  return withErrorHeadline({
    // (Writers)
    ApiDocs: npmScript({ script: "docs:api", label: "API docs" }),
    // The committed `docs/api-report/*` Markdown must match what `docs:api:report` produces now.
    // `mustNotChange` reruns the consumer's own script and fails if it touches the watched path.
    ApiDocsReport: npmScript({
      script: "docs:api:report",
      label: "API docs report",
      mustNotChange: ["docs/api-report"],
    }),
    // Package-specific: extracts named sections from a consumer's own example CLI output and
    // diffs them against README prose unique to that package. That is too bespoke to centralize the
    // way Schema and Docs are. So this gates whatever the consumer's script does, the fallback the
    // maintainer chose over moving that logic here. A package without the script passes as not
    // applicable, `npmScript`'s default.
    ReadmeExample: npmScript({
      script: "verify:readme-example",
      label: "README example freshness",
    }),
    Lint: tier.Lint,
    Format: tier.Format,
    Schema: npmScript({ script: "schema", label: "Schema", mustNotChange: ["schemas"] }),

    // (Build barrier)
    // `isolated`, and it fails when the package has no build script (checks/strict.ts).
    Build: tier.Build,

    // (Readers)
    // Needs `dist/.dts/`, unlike the TypeDoc-based checks above, which read source directly.
    // Declaration order (writers, then the Build barrier) guarantees a fresh build, so no
    // `dependsOn` is needed. See checks/api-contract.ts for what the diff decides.
    ApiContract: apiContract,
    // The same semver gate for the rest of the public surface: CLI help, exported schemas, the Action.
    SurfaceContract: surfaceContract(),
    Typecheck: tier.Typecheck,
    // The same type check on only what git tracks: a file hidden by .gitignore passes everything else.
    CleanCheckout: cleanCheckoutCheck(),
    // `isolated`: Vitest with V8 coverage instrumentation is the heaviest check. A consumer's
    // subprocess-spawning integration tests flake under CPU contention from a concurrent jscpd,
    // knip or depcruise. Examples: a real `npm pack`, a spawned CLI, a full
    // `ts-json-schema-generator` program. Running it alone trades ~40s of wall time for a
    // trustworthy signal.
    Tests: { ...tests(), isolated: true },
    Architecture: architecture(),
    GithubActions: githubActions,
    GitHygiene: gitHygiene,
    GitHooks: gitHooksCheck(),
    LandingPage: landingPageCheck(),
    AdoptionMode: adoptionModeCheck(),
    GeneratedRegions: generatedRegionsCheck(),
    PromptBlocks: promptBlocksCheck(),
    EnvContract: envContractCheck(),
    ReadmeStructure: readmeStructureCheck(),
    ScorecardWorkflow: scorecardWorkflowCheck(),
    EngineMatrix: engineMatrixCheck(),
    ManagedFiles: managedFilesCheck(),
    PinConsistency: pinConsistency(),
    BranchProtection: branchProtection,
    // Both read what Tests wrote. The tier declares the same order.
    Coverage: { ...coverageInScope(tier.Coverage), dependsOn: ["Tests"] as const },
    Crap: { ...crapInScope(tier.Crap), dependsOn: ["Coverage"] as const },
    Size: npmScript({ script: "size", label: "Size" }),
    // Both gate what ships: the build output the Build barrier above produced. NoMinify has no
    // exceptions. Every URL DistNoUrls finds needs a record in the consumer's registry
    // `.repo-contract/exceptions/dist-urls.json` (see checks/dist-no-urls.ts).
    NoMinify: noMinify(),
    DistNoUrls: distNoUrlsCheck(),
    Duplication: tier.Duplication,
    // On a `private: true` package the tier passes these library checks as not applicable.
    Packaging: tier.Packaging,
    // Reads only package.json, so it waits for nothing. It gates the manifest npm would publish.
    BundledDependencies: tier.BundledDependencies,
    // `dependsOn: ["Tests"] as const`: this packs a tarball, and a consumer's install-and-run
    // integration tests can pack too. Running them in turn keeps them from racing under load.
    TypeResolution: { ...typeResolutionCheck(tier.TypeResolution), dependsOn: ["Tests"] as const },
    PackedConsumer: { ...packedConsumerCheck(), dependsOn: ["Tests"] as const },
    // The tier's check, so a private package passes as not applicable. It packs too, so it waits on Tests.
    QuickStart: { ...quickStartCheck({ check: tier.QuickStart }), dependsOn: ["Tests"] as const },
    Licenses: tier.Licenses,
    DocsMarkdown: tier.DocsMarkdown,
    BenchmarkGuides: benchmarkGuides(),
    BenchmarkComplexity: benchmarkComplexityCheck(),
    BenchmarkCoverage: benchmarkCoverageCheck(),
    DocsLinks: docsLinks,
    DocsFragments: docsFragments,
    Prose: proseCheck(),
    // No dependsOn: declaration order runs writers (ApiDocs among them), then the Build barrier,
    // then readers. So docs/api/ is fresh before this reader runs. repo-contract registers
    // `accessibility,` the same plain way.
    Accessibility: accessibility,
    SecurityDeps: securityDeps(),
    SecurityDevDeps: securityDevDeps(),
    SecuritySecrets: securitySecrets(),
    SecuritySocket: securitySocket(),
    // Rejects the open GitHub code-scanning alerts of this ref (`gh` locally, GH_TOKEN in CI), waiving
    // only the ones in development-only code via the committed registry.
    CodeScanning: codeScanning(),
    // Every suppression comment is read back as evidence, and must give its reason (or have a record).
    Suppressions: suppressions(),
    DeadCode: deadCode(),
    Commits: commits(),
    // Declared late among the readers; only `Mutation`'s barrier follows. A real review is a
    // minutes-long network round trip, the slowest reader by far. So every fast, deterministic
    // verdict surfaces before it. It is not `isolated`, unlike `Tests` and `Mutation`: it waits on
    // the network instead of saturating cores. repo-contract registers `coderabbitai,` the same
    // way. When it cannot run (CI, no CLI installed, a detached checkout) it warns on every run, by
    // design: see checks/coderabbitai.ts.
    CodeRabbit: coderabbitai(),
    // `isolated` and last, with IPC's 100% floor and IPC_MUTATION_* as options (checks/strict.ts).
    Mutation: tier.Mutation,
  })
}
