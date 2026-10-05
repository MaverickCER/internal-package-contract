// The `npm audit` runs behind the `SecurityDevDeps` check, separated from its entry point
// (audit-dev-deps.mjs) so they can be tested without a registry.

/**
 * @typedef {(command: string, args: string[], options: object) => { error?: Error & { code?: string }, stdout?: string, stderr?: string }} Spawn
 */

/**
 * Runs one `npm audit --json` and parses it. `npm audit` exits non-zero whenever it finds anything, so
 * the exit code is not an error signal; only a spawn failure or unparseable output is.
 * @param {Spawn} spawn
 * @param {string[]} extraArgs - e.g. `["--omit=dev"]`.
 * @returns {{ value: object } | { error: string }}
 */
export function audit(spawn, extraArgs) {
  const result = spawn("npm", ["audit", ...extraArgs, "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) {
    return { error: `${result.error.code ?? "spawn error"}: ${result.error.message}` }
  }
  try {
    return { value: JSON.parse(result.stdout) }
  } catch {
    const label = extraArgs.length > 0 ? `npm audit ${extraArgs.join(" ")}` : "npm audit"
    return {
      error: `${label} did not print JSON: ${(result.stderr || result.stdout || "").slice(0, 300)}`,
    }
  }
}

/**
 * The whole-tree audit and the production-only audit, as the envelope the check reads.
 * @param {Spawn} spawn
 * @returns {{ ok: true, all: object, production: object } | { ok: false, error: string }}
 */
export function auditBothTrees(spawn) {
  const all = audit(spawn, [])
  const production = audit(spawn, ["--omit=dev"])
  const failed = all.error ?? production.error
  return failed === undefined
    ? { ok: true, all: all.value, production: production.value }
    : { ok: false, error: failed }
}
