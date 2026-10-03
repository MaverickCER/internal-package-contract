/**
 * The organization's engineering standard for a *publishable package*, expressed
 * once as a repo-contract contract.
 *
 * A clone of repo-contract's own `repo-contract.config.ts`, adapted to govern a
 * consuming package. Where repo-contract wires a check to one of its own private
 * `scripts/*`, a generic equivalent lives in `./checks/`; every other check is a
 * `repo-contract/presets` preset. Every tool that needs a config file gets one
 * from `./config/` when the consumer has not written its own, so the contract
 * enforces real rules out of the box; a consumer only writes a config to add
 * package-specific rules, and can `init` to scaffold the repo files + git hooks.
 *
 * Read-only against the consumer's source tree. `Build`/`Coverage`/`Mutation`
 * write only build/coverage/report artifacts, which `bin/contract.mjs` cleans up.
 *
 * Declaration order = schedule (repo-contract ADR 0002), three phases:
 *  1. Writers -- `ApiDocs`, `ApiDocsReport`, `ReadmeExample`, `Lint`, `Format`,
 *     `Schema` (Lint/Format are the read-only `--check` forms).
 *  2. `Build` (`isolated`) -- barrier; readers below always see a fresh `dist/`.
 *  3. Readers -- everything else, concurrent. `ApiContract` needs the fresh
 *     `dist/.dts/` this barrier provides, unlike the TypeDoc-based writers
 *     above (which read source directly). `Tests` runs Vitest once WITH
 *     coverage; `Coverage` and `Crap` `dependsOn` it and only read its
 *     artifacts (one Vitest run, not three). `Mutation` is `isolated`, declared
 *     last, and always runs (it is minutes-to-tens-of-minutes on a large `src/`);
 *     without a `stryker.config.*` of the consumer's own, the bundled baseline runs.
 *
 * `api-contract` is no longer on the "not cloned" list below: it moved here
 * entirely (see `checks/api-contract.ts`'s own module comment) rather than
 * staying duplicated in repo-contract, once repo-contract's own migration off
 * release-please onto Changesets meant every repo in this fleet shares one
 * "declared bump" rule. repo-contract now consumes this engine as a
 * devDependency instead of hosting its own copy.
 *
 * Not cloned (encode repo-contract's own design, not a general standard):
 * `suppression-governance`, `security-network`, `adr-governance`, and the
 * `test-unit/integration/property/e2e` split.
 *
 * `accessibility` *was* on that list until it wasn't: repo-contract's own
 * `docs/index.html` website rebuild (and the matching one for env-cap/
 * data-cap) made a real, mechanically-checked accessibility pass worth
 * having generically, not just for repo-contract's own site -- see
 * `checks/accessibility.ts`. `docsLinks` grew the matching HTML-mode
 * linkinator crawl over `docs/` at the same time (previously Markdown-only,
 * via `README.md` -- see that check's own doc comment).
 */
import crossSpawn, { sync as crossSpawnSync } from "cross-spawn"
import { defineRepoContract } from "repo-contract"
import { format, license, lint, publint, typecheck } from "repo-contract/presets"
import { accessibility } from "./checks/accessibility.js"
import { apiContract } from "./checks/api-contract.js"
import { architecture } from "./checks/architecture.js"
import { arethetypeswrong } from "./checks/arethetypeswrong.js"
import { branchProtection } from "./checks/branch-protection.js"
import { coderabbitai } from "./checks/coderabbitai.js"
import { commits } from "./checks/commits.js"
import { coverage } from "./checks/coverage.js"
import { crap } from "./checks/crap.js"
import { deadCode } from "./checks/dead-code.js"
import { distNoUrlsCheck } from "./checks/dist-no-urls.js"
import { duplication } from "./checks/duplication.js"
import { docsFragments } from "./checks/docs-fragments.js"
import { docsLinks } from "./checks/docs-links.js"
import { docsMarkdown } from "./checks/docs-markdown.js"
import { gitHygiene } from "./checks/git-hygiene.js"
import { githubActions } from "./checks/github-actions.js"
import { mutation } from "./checks/mutation.js"
import { noMinify } from "./checks/no-minify.js"
import { npmScriptCheck } from "./checks/npm-script.js"
import { securityDeps } from "./checks/security-deps.js"
import { securitySecrets } from "./checks/security-secrets.js"
import { codeScanning } from "./checks/code-scanning.js"
import { securitySocket } from "./checks/security-socket.js"
import { tests } from "./checks/tests.js"

export default defineRepoContract({
  // repo-contract never spawns a process or reads process.env itself (v0.2.0+,
  // ADR 0011 upstream) -- cross-spawn (already a dependency, used by
  // bin/init.mjs too) resolves Windows .cmd/.bat shims the same way every
  // check here already relies on; killProcessTree lets a timed-out/aborted
  // check's full process tree get cleaned up there too. See repo-contract's
  // README "Supplying spawn/env" section.
  spawn: crossSpawn,
  env: process.env,
  killProcessTree: crossSpawnSync,
  checks: {
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
    Coverage: { ...coverage, dependsOn: ["Tests"] },
    Crap: { ...crap, dependsOn: ["Coverage"] },
    Size: npmScriptCheck({ script: "size", label: "Size" }),
    // Both gate what actually ships (the build output the Build barrier above just produced).
    // NoMinify has no exceptions at all; every URL DistNoUrls finds needs a record in the consumer's
    // reviewed-exception registry `.repo-contract/exceptions/dist-urls.json` (see checks/dist-no-urls.ts).
    NoMinify: noMinify(),
    DistNoUrls: distNoUrlsCheck(),
    Duplication: duplication,
    Packaging: publint,
    // `dependsOn: ["Tests"]` -- this packs a tarball, and a consumer's own
    // install-and-run integration tests can pack too; keep the two off each
    // other's back rather than racing under load.
    TypeResolution: { ...arethetypeswrong, dependsOn: ["Tests"] },
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
    SecuritySecrets: securitySecrets(),
    SecuritySocket: securitySocket(),
    // Local only (a no-op in CI): rejects open GitHub code-scanning alerts, waiving only the ones in
    // development-only code via a git-ignored registry.
    CodeScanning: codeScanning(),
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
  },
})
