/**
 * The standard: every check a MaverickCER package must continuously satisfy, as a map
 * of check id -> definition. `contract.ts` wraps this in a `defineRepoContract` for a
 * consuming package; `repo-contract`'s own self-contract composes it too, overriding only what
 * it must (`{ ...standardChecks(), Coverage: stricter }`) and adding what is its own alone, so
 * "a MaverickCER package" means one thing and a fix to a check lands once.
 *
 * Declaration order = schedule (repo-contract ADR 0002); see `contract.ts` for the phases.
 * @returns A fresh check map. Resolution of each tool's config (the consumer's own, else the bundled
 *   one) happens now, with the repository as the working directory.
 */
import { format, license, lint, publint, typecheck } from "repo-contract/presets"
import { accessibility } from "./accessibility.js"
import { apiContract } from "./api-contract.js"
import { architecture } from "./architecture.js"
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
import { docsLinks } from "./docs-links.js"
import { docsMarkdown } from "./docs-markdown.js"
import { gitHygiene } from "./git-hygiene.js"
import { githubActions } from "./github-actions.js"
import { mutation } from "./mutation.js"
import { noMinify } from "./no-minify.js"
import { npmScriptCheck } from "./npm-script.js"
import { securityDeps } from "./security-deps.js"
import { securityDevDeps } from "./security-dev-deps.js"
import { securitySecrets } from "./security-secrets.js"
import { suppressions } from "./suppressions.js"
import { codeScanning } from "./code-scanning.js"
import { securitySocket } from "./security-socket.js"
import { tests } from "./tests.js"

export function standardChecks() {
  return {
    // -- Writers --
    ApiDocs: npmScriptCheck({ script: "docs:api", label: "API docs" }),
    // The committed `docs/api-report/*` Markdown must already match what `docs:api:report`
    // (TypeDoc + typedoc-plugin-markdown) produces right now -- `mustNotChange` reruns the
    // consumer's own regeneration script and fails if it touches the watched path, exactly what
    // each consumer's own now-deleted `scripts/check-api-report.mjs` did by hand. See ADR/notes on
    // the api-docs-report dedup for why this replaced two near-identical per-consumer scripts.
    ApiDocsReport: npmScriptCheck({
      script: "docs:api:report",
      label: "API docs report",
      mustNotChange: ["docs/api-report"],
    }),
    // Package-specific: extracts named sections from a consumer's own example CLI output and
    // diffs them against README prose unique to that package -- too bespoke to centralize the way
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

    // -- Build barrier --
    Build: {
      ...npmScriptCheck({ script: "build", label: "Build", whenMissing: "fail" }),
      isolated: true,
    },

    // -- Readers --
    // Needs `dist/.dts/` (unlike the TypeDoc-based checks above, which read source directly) --
    // declaration-order phasing (writers, then the Build barrier) already guarantees a fresh build
    // before this runs, so no explicit `dependsOn` is needed. Diffs every target's real,
    // current public surface (see scripts/api-contract/targets.ts) against its committed baseline
    // and fails when the branch's changesets under-declare the resulting bump -- see
    // checks/api-contract.ts's own module comment.
    ApiContract: apiContract,
    Typecheck: typecheck,
    // `isolated` -- Vitest with V8 coverage instrumentation is the single
    // heaviest check, and a consumer's own subprocess-spawning integration tests
    // (a real `npm pack`, a spawned CLI, a full `ts-json-schema-generator`
    // program) flake under CPU contention from a concurrent jscpd / knip /
    // depcruise. Running it alone trades ~40s of wall time for a trustworthy
    // signal -- the whole point of the check.
    Tests: { ...tests(), isolated: true },
    Architecture: architecture(),
    GithubActions: githubActions,
    GitHygiene: gitHygiene,
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
    // `dependsOn: ["Tests"] as const` -- this packs a tarball, and a consumer's own
    // install-and-run integration tests can pack too; keep the two off each
    // other's back rather than racing under load.
    TypeResolution: { ...arethetypeswrong, dependsOn: ["Tests"] as const },
    Licenses: license,
    DocsMarkdown: docsMarkdown(),
    DocsLinks: docsLinks,
    DocsFragments: docsFragments,
    // No explicit dependsOn needed: declaration-order phasing (writers,
    // including ApiDocs, then the Build barrier, then readers) already
    // guarantees docs/api/ is freshly generated before this reader runs --
    // matches repo-contract's own plain `accessibility,` registration.
    Accessibility: accessibility,
    SecurityDeps: securityDeps(),
    SecurityDevDeps: securityDevDeps(),
    SecuritySecrets: securitySecrets(),
    SecuritySocket: securitySocket(),
    // Local only (a no-op in CI): rejects open GitHub code-scanning alerts, waiving only the ones in
    // development-only code via a git-ignored registry.
    CodeScanning: codeScanning(),
    // Every suppression comment is read back as evidence, and must give its reason (or have a record).
    Suppressions: suppressions(),
    DeadCode: deadCode(),
    Commits: commits(),
    // Declared late among the readers (only `Mutation`'s own barrier follows):
    // the slowest reader by far on a real reviewed run -- a network round trip
    // to a remote AI review, minutes long -- so every fast, deterministic
    // check's verdict surfaces before it. NOT `isolated`, unlike
    // `Tests`/`Mutation`: it waits on a network response rather than
    // saturating cores, so it contends with nothing -- matching
    // repo-contract's own plain `coderabbitai,` registration. Its own
    // non-execution (CI, no CLI installed, a detached checkout) is a visible
    // `warn` on every run, by design -- see checks/coderabbitai.ts.
    CodeRabbit: coderabbitai(),
    Mutation: { ...mutation(), isolated: true },
  }
}
