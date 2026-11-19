/**
 * `QuickStart`: the README's first commands work against the tarball npm would publish.
 *
 * Reads: the fenced `sh` block between `<!-- quick-start:begin -->` and `<!-- quick-start:end -->`
 * in `README.md`, through repo-contract's `quickStart` preset and `repo-contract quick-start --json`.
 * That command packs the package and makes an empty project: a directory holding only a
 * package.json. The command that installs the package installs the tarball instead. Then each line
 * runs in a shell, in order, within five minutes in total.
 *
 * Fails on a command that exits non-zero or outlasts the budget, with its last output. Fails on a
 * README with no marked block, on a malformed block, and on a block that never installs the package.
 * Never warns on a finding.
 *
 * Exceptions: none for a finding. One degradation, `QuickStart:network`: a command that failed with
 * a network error code (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`). It
 * warns locally. Under `--strict`, the CI default, it fails unless
 * `.repo-contract/exceptions/environment.json` holds a complete record. The record id is
 * `environment:QuickStart:network`. Any other failed install is a finding. A broken first install is
 * what this check exists to catch, so PackedConsumer's wider install rule is not copied.
 *
 * In the standard set, from repo-contract's tier: a `private: true` package passes it as not
 * applicable, though the command still runs. It waits on `Tests`, so the build it packs is done and
 * two packs never race.
 */
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { quickStart } from "repo-contract/presets"
import { degraded } from "./environment-exceptions.js"

/** The codes Node.js and npm print when a host cannot be reached. */
const NETWORK_ERROR = /\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b/

/**
 * @param input - What to wrap, and where the environment-exception registry is read from.
 * @param input.cwd - The repository root; defaults to the working directory.
 * @param input.check - The QuickStart check to wrap; the standard passes the tier's. Defaults to the bare preset.
 * @returns the `QuickStart` check.
 */
export function quickStartCheck(
  input: { readonly cwd?: string; readonly check?: CheckDefinitionConfig } = {},
): CheckDefinitionConfig {
  const preset = input.check ?? quickStart()
  return {
    ...preset,
    policy: async (context): Promise<PolicyResult> => {
      const verdict = await preset.policy(context)
      // The preset's failure text carries the failed command's last output, which holds npm's error code.
      if (verdict.outcome === "fail" && NETWORK_ERROR.test(verdict.rationale)) {
        return degraded({
          check: "QuickStart",
          code: "network",
          rationale: `the quick start could not reach the network, so it was not judged. ${verdict.rationale}`,
          cwd: input.cwd ?? process.cwd(),
        })
      }
      return { ...verdict, rationale: `QuickStart: ${verdict.rationale}` }
    },
  }
}
