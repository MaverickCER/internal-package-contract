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
 *  1. Writers: `ApiDocs`, `ApiDocsReport`, `ReadmeExample`, `Lint`, `Format`,
 *     `Schema` (Lint/Format are the read-only `--check` forms).
 *  2. `Build` (`isolated`): barrier; readers below always see a fresh `dist/`.
 *  3. Readers: everything else, concurrent. `ApiContract` needs the fresh
 *     `dist/.dts/` this barrier provides, unlike the TypeDoc-based writers
 *     above (which read source directly). `Tests` runs Vitest once WITH
 *     coverage; `Coverage` and `Crap` `dependsOn` it and only read its
 *     artifacts (one Vitest run, not three). `Mutation` is `isolated`, declared
 *     last, and always runs (it is minutes-to-tens-of-minutes on a large `src/`);
 *     without a `stryker.config.*` of the consumer's own, the bundled baseline runs.
 *
 * `ApiContract` lives here, not in repo-contract, because every repository in
 * this fleet releases with Changesets and so shares one "declared bump" rule;
 * repo-contract consumes it as a devDependency (see `checks/api-contract.ts`).
 * `accessibility` is generic too: every package's `docs/index.html` site gets
 * the same pa11y pass (`checks/accessibility.ts`), and `docsLinks` crawls the
 * built HTML under `docs/` as well as the Markdown.
 *
 * Not cloned, because they encode repo-contract's own design rather than a
 * general standard: `security-network`, `adr-governance`, and the
 * `test-unit/integration/property/e2e` split.
 */
import crossSpawn, { sync as crossSpawnSync } from "cross-spawn"
import { defineRepoContract } from "repo-contract"
import { optionalChecks, withOptionalChecks } from "./checks/optional.js"
import { standardChecks } from "./checks/standard.js"

export default defineRepoContract({
  // repo-contract never spawns a process or reads process.env itself (v0.2.0+,
  // ADR 0011 upstream): cross-spawn (already a dependency, used by
  // bin/scaffold.mjs too) resolves Windows .cmd/.bat shims the same way every
  // check here already relies on; killProcessTree lets a timed-out/aborted
  // check's full process tree get cleaned up there too. See repo-contract's
  // README "Supplying spawn/env" section.
  spawn: crossSpawn,
  env: process.env,
  killProcessTree: crossSpawnSync,
  // The optional checks a package turns on are only known at run time, so their ids cannot be typed here.
  checks: withOptionalChecks(standardChecks(), optionalChecks(process.cwd())) as ReturnType<
    typeof standardChecks
  >,
})
