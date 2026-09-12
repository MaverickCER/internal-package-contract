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
 *  1. Writers -- `ApiDocs`, `Lint`, `Format`, `Schema` (Lint/Format are the
 *     read-only `--check` forms).
 *  2. `Build` (`isolated`) -- barrier; readers below always see a fresh `dist/`.
 *  3. Readers -- everything else, concurrent. `Tests` runs Vitest once WITH
 *     coverage; `Coverage` and `Crap` `dependsOn` it and only read its
 *     artifacts (one Vitest run, not three). `Mutation` is `isolated`, declared
 *     last, and does not run at all without a `stryker.config.*` or
 *     `IPC_MUTATION=1` (it is minutes-to-tens-of-minutes on a large `src/`).
 *
 * Not cloned (encode repo-contract's own design, not a general standard):
 * `suppression-governance`, `api-contract`, `security-network`, `adr-governance`,
 * and the `test-unit/integration/property/e2e` split.
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
import { format, license, lint, publint, securityDeps, typecheck } from "repo-contract/presets"
import { accessibility } from "./checks/accessibility.js"
import { architecture } from "./checks/architecture.js"
import { arethetypeswrong } from "./checks/arethetypeswrong.js"
import { commits } from "./checks/commits.js"
import { coverage } from "./checks/coverage.js"
import { crap } from "./checks/crap.js"
import { deadCode } from "./checks/dead-code.js"
import { duplication } from "./checks/duplication.js"
import { docsFragments } from "./checks/docs-fragments.js"
import { docsLinks } from "./checks/docs-links.js"
import { docsMarkdown } from "./checks/docs-markdown.js"
import { gitHygiene } from "./checks/git-hygiene.js"
import { githubActions } from "./checks/github-actions.js"
import { mutation } from "./checks/mutation.js"
import { npmScriptCheck } from "./checks/npm-script.js"
import { securitySecrets } from "./checks/security-secrets.js"
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
    Lint: lint(),
    Format: { ...format, run: ["prettier", "--check", "."] },
    Schema: npmScriptCheck({ script: "schema", label: "Schema", mustNotChange: ["schemas"] }),

    // -- Build barrier --
    Build: {
      ...npmScriptCheck({ script: "build", label: "Build", whenMissing: "fail" }),
      isolated: true,
    },

    // -- Readers --
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
    Coverage: { ...coverage, dependsOn: ["Tests"] },
    Crap: { ...crap, dependsOn: ["Coverage"] },
    Size: npmScriptCheck({ script: "size", label: "Size" }),
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
    SecurityDeps: securityDeps,
    SecuritySecrets: securitySecrets(),
    SecuritySocket: securitySocket(),
    DeadCode: deadCode(),
    Commits: commits(),
    Mutation: { ...mutation(), isolated: true },
  },
})
