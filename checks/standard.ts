/**
 * The standard: every check a package must keep passing, as one map of check id to definition, in
 * schedule order. `contract.ts` wraps it for a consumer. `repo-contract.config.ts` composes IPC's
 * own self-contract from the same functions, leaving out the checks that need a `dist/` or a
 * published package.
 *
 * Declaration order is the schedule. First the writers: `ApiDocs`, `ApiDocsReport`,
 * `ReadmeExample`, `Lint`, `Format`, `Schema`. Then the `Build` barrier. Then the readers,
 * concurrent except where `isolated` or `dependsOn` says otherwise, with `Mutation` last. Each
 * check's own header says what it reads and what fails it. Tool configs are resolved when this
 * function runs, with the package as the working directory.
 * @returns A fresh check map, each policy wrapped so a failure leads with the error its tool died
 *   with.
 */
import { format, license, lint, publint, typecheck } from "repo-contract/presets"
import { accessibility } from "./accessibility.js"
import { apiContract } from "./api-contract.js"
import { architecture } from "./architecture.js"
import { benchmarkComplexityCheck } from "./benchmark-complexity.js"
import { benchmarkCoverageCheck } from "./benchmark-coverage.js"
import { benchmarkGuides } from "./benchmark-guides.js"
import { arethetypeswrong } from "./arethetypeswrong.js"
import { branchProtection } from "./branch-protection.js"
import { coderabbitai } from "./coderabbitai.js"
import { commits } from "./commits.js"
import { coverage } from "./coverage.js"
import { crap } from "./crap.js"
import { deadCode } from "./dead-code.js"
import { distNoUrlsCheck } from "./dist-no-urls.js"
import { duplication } from "./duplication.js"
import { docsFragments } from "./docs-fragments.js"
import { proseCheck } from "./prose.js"
import { docsLinks } from "./docs-links.js"
import { docsMarkdown } from "./docs-markdown.js"
import { engineMatrixCheck } from "./engine-matrix.js"
import { packedConsumerCheck } from "./packed-consumer.js"
import { gitHooksCheck } from "./git-hooks.js"
import { adoptionModeCheck } from "./adoption-mode.js"
import { withErrorHeadline } from "./shared.js"
import { envContractCheck } from "./env-contract.js"
import { generatedRegionsCheck } from "./generated-regions.js"
import { promptBlocksCheck } from "./prompt-blocks.js"
import { landingPageCheck } from "./landing-page.js"
import { readmeStructureCheck } from "./readme-structure.js"
import { scorecardWorkflowCheck } from "./scorecard-workflow.js"
import { cleanCheckoutCheck } from "./clean-checkout.js"
import { gitHygiene } from "./git-hygiene.js"
import { githubActions } from "./github-actions.js"
import { managedFilesCheck } from "./managed-files.js"
import { mutation } from "./mutation.js"
import { noMinify } from "./no-minify.js"
import { pinConsistency } from "./pin-consistency.js"
import { npmScriptCheck } from "./npm-script.js"
import { securityDeps } from "./security-deps.js"
import { securityDevDeps } from "./security-dev-deps.js"
import { securitySecrets } from "./security-secrets.js"
import { suppressions } from "./suppressions.js"
import { surfaceContract } from "./surface-contract.js"
import { codeScanning } from "./code-scanning.js"
import { securitySocket } from "./security-socket.js"
import { tests } from "./tests.js"

export function standardChecks() {
  return withErrorHeadline({
    // (Writers)
    ApiDocs: npmScriptCheck({ script: "docs:api", label: "API docs" }),
    // The committed `docs/api-report/*` Markdown must match what `docs:api:report` produces now.
    // `mustNotChange` reruns the consumer's own script and fails if it touches the watched path.
    ApiDocsReport: npmScriptCheck({
      script: "docs:api:report",
      label: "API docs report",
      mustNotChange: ["docs/api-report"],
    }),
    // Package-specific: extracts named sections from a consumer's own example CLI output and
    // diffs them against README prose unique to that package. That is too bespoke to centralize the way
    // Schema/Docs are, so this just gates whatever the consumer's own script already does (the
    // fallback the maintainer chose over relocating that logic here).
    ReadmeExample: npmScriptCheck({
      script: "verify:readme-example",
      label: "README example freshness",
      whenMissing: "skip",
    }),
    Lint: lint(),
    Format: { ...format, run: ["prettier", "--check", "."] },
    Schema: npmScriptCheck({ script: "schema", label: "Schema", mustNotChange: ["schemas"] }),

    // (Build barrier)
    Build: {
      ...npmScriptCheck({ script: "build", label: "Build", whenMissing: "fail" }),
      isolated: true,
    },

    // (Readers)
    // Needs `dist/.dts/`, unlike the TypeDoc-based checks above, which read source directly.
    // Declaration order (writers, then the Build barrier) guarantees a fresh build, so no
    // `dependsOn` is needed. See checks/api-contract.ts for what the diff decides.
    ApiContract: apiContract,
    // The same semver gate for the rest of the public surface: CLI help, exported schemas, the Action.
    SurfaceContract: surfaceContract(),
    Typecheck: typecheck,
    // The same type check on only what git tracks: a file hidden by .gitignore passes everything else.
    CleanCheckout: cleanCheckoutCheck(),
    // `isolated`: Vitest with V8 coverage instrumentation is the single
    // heaviest check, and a consumer's own subprocess-spawning integration tests
    // (a real `npm pack`, a spawned CLI, a full `ts-json-schema-generator`
    // program) flake under CPU contention from a concurrent jscpd / knip /
    // depcruise. Running it alone trades ~40s of wall time for a trustworthy
    // signal: the whole point of the check.
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
    Coverage: { ...coverage, dependsOn: ["Tests"] as const },
    Crap: { ...crap, dependsOn: ["Coverage"] as const },
    Size: npmScriptCheck({ script: "size", label: "Size" }),
    // Both gate what actually ships (the build output the Build barrier above just produced).
    // NoMinify has no exceptions at all; every URL DistNoUrls finds needs a record in the consumer's
    // reviewed-exception registry `.repo-contract/exceptions/dist-urls.json` (see checks/dist-no-urls.ts).
    NoMinify: noMinify(),
    DistNoUrls: distNoUrlsCheck(),
    Duplication: duplication,
    Packaging: publint,
    // `dependsOn: ["Tests"] as const`: this packs a tarball, and a consumer's own
    // install-and-run integration tests can pack too; keep the two off each
    // other's back rather than racing under load.
    TypeResolution: { ...arethetypeswrong, dependsOn: ["Tests"] as const },
    PackedConsumer: { ...packedConsumerCheck(), dependsOn: ["Tests"] as const },
    Licenses: license,
    DocsMarkdown: docsMarkdown(),
    BenchmarkGuides: benchmarkGuides(),
    BenchmarkComplexity: benchmarkComplexityCheck(),
    BenchmarkCoverage: benchmarkCoverageCheck(),
    DocsLinks: docsLinks,
    DocsFragments: docsFragments,
    Prose: proseCheck(),
    // No explicit dependsOn needed: declaration-order phasing (writers,
    // including ApiDocs, then the Build barrier, then readers) already
    // guarantees docs/api/ is freshly generated before this reader runs;
    // matches repo-contract's own plain `accessibility,` registration.
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
    // Declared late among the readers (only `Mutation`'s own barrier follows):
    // the slowest reader by far on a real reviewed run (a network round trip
    // to a remote AI review, minutes long) so every fast, deterministic
    // check's verdict surfaces before it. NOT `isolated`, unlike
    // `Tests`/`Mutation`: it waits on a network response rather than
    // saturating cores, so it contends with nothing; matching
    // repo-contract's own plain `coderabbitai,` registration. Its own
    // non-execution (CI, no CLI installed, a detached checkout) is a visible
    // `warn` on every run, by design: see checks/coderabbitai.ts.
    CodeRabbit: coderabbitai(),
    Mutation: { ...mutation(), isolated: true },
  })
}
