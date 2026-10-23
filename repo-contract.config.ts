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
 * This repository has no `src/` -- its real code lives in `checks/`, `scripts/` and `bin/` (the scope
 * in `scope.mjs`, mirrored by `vitest.config.ts`'s coverage scope and `stryker.config.mjs`'s `mutate`).
 * `Architecture`/`Crap`/`Duplication` all hardcode a `"src"` scan-path positional in their `run` (the
 * same shape every consumer's own `src/` would occupy) -- the `...OverScope` helpers below retarget it
 * at those trees, leaving out only the process entry points `scope.mjs` names, exactly the "run
 * override is the escape hatch" pattern `contract.ts` itself documents for a consumer that needs to
 * differ from a preset's generic default.
 *
 * `Mutation` is `isolated: true` and declared last, same reasoning and same
 * position as `contract.ts`'s own `Mutation` -- Stryker spawns its own worker
 * pool, and every other reader (including `Lint`, which would otherwise risk
 * scanning Stryker's `.stryker-tmp/` sandbox copy mid-run) has already
 * finished by the time it starts.
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
import { docsLinks } from "./checks/docs-links.js"
import { docsMarkdown } from "./checks/docs-markdown.js"
import { cleanCheckoutCheck } from "./checks/clean-checkout.js"
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
    // `isolated` -- the single heaviest check (Vitest with V8 coverage
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
    // Same reviewed-exceptions filter contract.ts's own SecurityDeps uses (see
    // checks/security-deps.ts) -- dogfooded here rather than duplicated.
    SecurityDeps: securityDeps(),
    SecurityDevDeps: securityDevDeps(),
    SecuritySecrets: securitySecrets(),
    SecuritySocket: securitySocket(),
    Suppressions: suppressions(),
    DeadCode: deadCode(),
    Commits: commits(),
    Mutation: { ...mutation(), isolated: true },
  },
})
