/**
 * A generic check that runs one of the consumer's own npm scripts.
 *
 * Several of repo-contract's bespoke checks reduce to this shape:
 *   - `build`    -> run `build`, must exit 0
 *   - `size`     -> run `size`, must exit 0 (the consumer's script owns the budget)
 *   - `api-docs` -> run `docs:api`, must exit 0
 *   - `schema`   -> run `schema`, must exit 0 AND regenerate nothing (the
 *                   committed `schemas/*.json` already match their source types)
 *
 * repo-contract wires these to its own private `scripts/*.mjs`; expressed against
 * a consumer's own scripts they become one small factory. The "regenerate
 * nothing" variant (`mustNotChange`) runs through
 * {@link file://../scripts/run-generated.mjs}, which diffs the watched paths by
 * content hash before/after -- so it works even in a repo with no git history.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput, hasScript } from "./shared.js"

const runGeneratedScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "run-generated.mjs",
)

/** Options for {@link npmScriptCheck}. */
export interface NpmScriptCheckOptions {
  /** The npm script to run (`npm run <script>`). */
  readonly script: string
  /** Human-readable name for rationales (e.g. "Build", "Schema"). */
  readonly label: string
  /**
   * When the consumer has no such script: `"skip"` passes with a note (the
   * default -- not every package generates schemas or API docs); `"fail"`
   * blocks (the package is expected to have this script).
   */
  readonly whenMissing?: "skip" | "fail"
  /**
   * Paths (repo-relative dirs/files) whose contents must be byte-identical
   * before and after the script runs -- i.e. the script only verified
   * already-committed generated output. Setting this switches execution to the
   * hash-diff wrapper.
   */
  readonly mustNotChange?: readonly string[]
}

interface GeneratedResult {
  readonly ran: boolean
  readonly exitCode: number | null
  readonly changed: readonly string[]
}

/**
 * Builds a check that runs `npm run <script>` in the consumer's repo.
 * @param options - see {@link NpmScriptCheckOptions}.
 * @returns the configured check.
 */
export function npmScriptCheck(options: NpmScriptCheckOptions): CheckDefinitionConfig {
  // Stryker disable next-line StringLiteral: an equivalent mutant -- `whenMissing`'s only use
  // (below) is `whenMissing === "fail"`, so any default other than the literal string `"fail"`
  // itself (this default, or a mutated one) is behaviorally identical: "not fail" always means
  // "skip". Hand-verified: forcing this default to `""` leaves every test in npm-script.test.ts
  // passing unchanged.
  const { script, label, whenMissing = "skip", mustNotChange } = options
  const watchesArtifacts = Boolean(mustNotChange && mustNotChange.length > 0)

  // Stryker disable ArrayDeclaration: unreachable, not just unobservable -- `watchesArtifacts` is
  // only ever `true` when `mustNotChange` is itself truthy with `length > 0` (see above), so by
  // the time this ternary's true branch runs, `mustNotChange` can never be nullish -- the `?? []`
  // fallback exists only to satisfy the parameter's own `readonly string[] | undefined` type, and
  // no call can ever reach it at runtime.
  const run = watchesArtifacts
    ? ["node", runGeneratedScript, script, ...(mustNotChange ?? [])]
    : ["npm", "--loglevel=silent", "run", script]
  // Stryker restore ArrayDeclaration

  return {
    run,
    policy: ({ result }): PolicyResult => {
      if (!hasScript(script)) {
        return whenMissing === "fail"
          ? {
              outcome: "fail",
              rationale: `${label}: the consumer defines no \`${script}\` npm script. Add one so this can be verified.`,
            }
          : {
              outcome: "pass",
              rationale: `${label}: no \`${script}\` npm script -- not applicable to this package.`,
            }
      }

      const terminated = abnormalTermination(result, `\`npm run ${script}\``)
      if (terminated) return { outcome: "fail", rationale: terminated }

      if (!watchesArtifacts) {
        if (result.exitCode !== 0) {
          const tail = combinedOutput(result).slice(-4000)
          return {
            outcome: "fail",
            rationale: `${label}: \`npm run ${script}\` exited ${String(result.exitCode)}.${tail ? `\n${tail}` : ""}`,
          }
        }
        return { outcome: "pass", rationale: `${label}: \`npm run ${script}\` succeeded.` }
      }

      let parsed: GeneratedResult
      try {
        // Stryker disable next-line StringLiteral: unreachable, not just unobservable --
        // `String.prototype.split` always returns an array with at least one element (even
        // `"".split("\n")` is `[""]`), so `.at(-1)` on it can never be `undefined`; the `?? ""`
        // fallback exists only to satisfy `.at`'s own possibly-`undefined` return type.
        const lastLine = result.stdout.trim().split("\n").at(-1) ?? ""
        parsed = JSON.parse(lastLine) as GeneratedResult
      } catch {
        return {
          outcome: "fail",
          rationale: `${label}: could not read the regeneration result.\n${combinedOutput(result).slice(-3000)}`,
        }
      }

      if (parsed.exitCode !== 0) {
        return {
          outcome: "fail",
          rationale: `${label}: \`npm run ${script}\` exited ${String(parsed.exitCode)}.\n${combinedOutput(result).slice(-3000)}`,
        }
      }

      if (parsed.changed.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            `${label}: \`npm run ${script}\` regenerated ${String(parsed.changed.length)} file(s) -- the committed output is stale. Run it locally and commit:`,
            ...parsed.changed.map((p) => `- ${p}`),
          ].join("\n"),
        }
      }

      return {
        outcome: "pass",
        rationale: `${label}: \`npm run ${script}\` succeeded and regenerated nothing.`,
      }
    },
  }
}
