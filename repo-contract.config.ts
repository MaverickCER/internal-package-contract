/**
 * This package's own self-hosting contract -- internal-package-contract
 * governing itself using itself, via `npm run contract` (scripts/run-contract.mjs),
 * exercising every check's real `run`/`policy` the exact same way a consumer
 * (env-cap, data-cap, ...) does, not a special internal shortcut.
 *
 * This is a SEPARATE file from `contract.ts`: `contract.ts` is this package's
 * exported product -- the contract a CONSUMER's repo runs, read-only against
 * that consumer's own source tree, with its own `Build`/`Packaging`/
 * `TypeResolution` checks (that consumer publishes a built `dist/`). This
 * package ships raw `.ts` source with no `dist/` and no `build` script at all
 * (see package.json's `exports`, which point straight at `.ts` files) -- those
 * three checks would either be vacuously not-applicable or actively wrong here,
 * so they are simply not declared below, rather than wired and skipped.
 *
 * No Writers / isolated-build-barrier phase, unlike `contract.ts`'s own doc
 * comment (cloned from repo-contract's own self-hosting config, whose `lint`/
 * `format` genuinely rewrite source via `--fix`/`--write`): every check below
 * is read-only, exactly like `contract.ts`'s own `Lint`/`Format` (`--format
 * json` / `--check .`), so nothing here ever races a concurrent rewrite --
 * there is nothing to serialize before. `Coverage`/`Crap` still `dependsOn`
 * `Tests` for the real evidence dependency (they read artifacts `Tests`
 * produces), the same as `contract.ts`.
 *
 * This repository has no `src/` -- its real code lives in `checks/` (mirrored
 * by `vitest.config.ts`'s `coverage.include` and `stryker.config.mjs`'s
 * `mutate`, both at this package's own root). `Architecture`/`Crap`/
 * `Duplication` all hardcode a `"src"` scan-path positional in their `run`
 * (the same shape every consumer's own `src/` would occupy) -- `withScanTarget`
 * below retargets that one positional at `checks` for each, exactly the "run
 * override is the escape hatch" pattern `contract.ts` itself documents for a
 * consumer that needs to differ from a preset's generic default. `bin/` and
 * `scripts/` (this package's CLI/tooling entry points, not its tested library
 * surface -- no coverage instrumentation, no mutation testing) are
 * deliberately excluded from that scan for the same reason: `Crap` reads
 * `coverage/coverage-final.json`, which has no entries for either, and
 * scoring an uninstrumented function against 0% coverage would be a false
 * CRAP-threshold failure, not a real one.
 *
 * `Mutation` is `isolated: true` and declared last, same reasoning and same
 * position as `contract.ts`'s own `Mutation` -- Stryker spawns its own worker
 * pool, and every other reader (including `Lint`, which would otherwise risk
 * scanning Stryker's `.stryker-tmp/` sandbox copy mid-run) has already
 * finished by the time it starts.
 */
import crossSpawn, { sync as crossSpawnSync } from "cross-spawn"
import { defineRepoContract } from "repo-contract"
import type { CheckDefinitionConfig, PolicyContext } from "repo-contract"
import { format, license, lint, typecheck } from "repo-contract/presets"
import { architecture } from "./checks/architecture.js"
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
import { securityDeps } from "./checks/security-deps.js"
import { securitySecrets } from "./checks/security-secrets.js"
import { securitySocket } from "./checks/security-socket.js"
import { tests } from "./checks/tests.js"

/** Replaces the scan-path positional (always index 1: `[tool, path, ...flags]`) a `run` array hardcodes, for a check whose default scan target (`"src"`) does not exist in this repository. */
function withScanTarget(check: CheckDefinitionConfig, target: string): CheckDefinitionConfig {
  const run = [...(check.run as readonly string[])]
  run[1] = target
  return { ...check, run }
}

export default defineRepoContract({
  spawn: crossSpawn,
  env: process.env,
  killProcessTree: crossSpawnSync,
  checks: {
    Lint: lint(),
    Format: { ...format, run: ["prettier", "--check", "."] },
    Typecheck: { ...typecheck, run: ["tsc", "--noEmit", "-p", "tsconfig.self.json"] },
    // `isolated` -- the single heaviest check (Vitest with V8 coverage
    // instrumentation), same reasoning as `contract.ts`'s own `Tests`.
    Tests: { ...tests(), isolated: true },
    Architecture: withScanTarget(architecture(), "checks"),
    GithubActions: githubActions,
    GitHygiene: gitHygiene,
    Coverage: { ...coverage, dependsOn: ["Tests"] },
    Crap: { ...withScanTarget(crap, "checks"), dependsOn: ["Coverage"] },
    Duplication: withScanTarget(duplication, "checks"),
    // `run` override (`contract.ts`'s own "Preset options are the preferred
    // way...; a direct run override is an escape hatch"): the published
    // `license` preset's default `run` passes `--osi` on the CLI, which
    // licensee's own docopt-declared CLI surface can widen only via
    // `--blueoak=RATING` -- there is no working CLI equivalent for an
    // arbitrary extra SPDX id (`--licenses` is documented in licensee's own
    // `--help` output but its CLI parser never actually wires that flag to
    // anything; confirmed by reading node_modules/licensee's own bin script).
    // Dropping every CLI policy flag here instead makes licensee fall through
    // to reading `.licensee.json` (this repo's own root config), which
    // accepts OSI-approved licenses plus Blue Oak Gold (the org's existing
    // exception, see repo-contract's own precedent for `minimatch`) plus
    // CC0-1.0/CC-BY-3.0/CC-BY-4.0/WTFPL -- every one of them a well-known,
    // broadly-recognized public-domain-or-attribution-only license this
    // package's own transitive tooling dependencies (jscpd, tar, glob,
    // caniuse-lite, the spdx-* metadata packages, ...) actually carry, not a
    // blanket loosening of the standard.
    Licenses: {
      ...license,
      run: ["licensee", "--production", "--errors-only", "--ndjson"],
      // Same technique as repo-contract's own `license` override: the
      // preset's own rationale strings are worded for its default
      // `--osi`-only `run` ("...non-OSI-approved license") -- rewrites only
      // those two known, exact stock strings so a reader never sees a policy
      // description narrower than what `.licensee.json` actually enforces.
      // Explicitly typed, matching repo-contract's own note on why: an
      // untyped `async (ctx) =>` here would otherwise widen
      // `defineRepoContract`'s `TChecks` inference for the whole `checks`
      // object.
      policy: async (ctx: PolicyContext) => {
        const result = await license.policy(ctx)
        if (
          result.outcome === "pass" &&
          result.rationale ===
            "licensee found 0 production dependencies with a non-OSI-approved license."
        ) {
          return {
            outcome: "pass",
            rationale:
              "licensee found 0 production dependencies without an OSI-approved, Blue Oak Gold-rated, or explicitly allow-listed (see .licensee.json) license.",
          }
        }
        if (result.outcome === "fail") {
          return {
            ...result,
            rationale: result.rationale.replace(
              "without an OSI-approved license:",
              "without an OSI-approved, Blue Oak Gold-rated, or explicitly allow-listed (see .licensee.json) license:",
            ),
          }
        }
        return result
      },
    },
    DocsMarkdown: docsMarkdown(),
    DocsLinks: docsLinks,
    DocsFragments: docsFragments,
    // Same reviewed-exceptions filter contract.ts's own SecurityDeps uses (see
    // checks/security-deps.ts) -- dogfooded here rather than duplicated.
    SecurityDeps: securityDeps(),
    SecuritySecrets: securitySecrets(),
    SecuritySocket: securitySocket(),
    DeadCode: deadCode(),
    Commits: commits(),
    Mutation: { ...mutation(), isolated: true },
  },
})
