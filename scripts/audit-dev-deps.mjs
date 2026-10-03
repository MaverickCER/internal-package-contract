// Entry point for the `SecurityDevDeps` check (see checks/security-dev-deps.ts).
//
// `SecurityDeps` audits what users install (`npm audit --omit=dev`). The published packages in this
// ecosystem have no runtime dependencies, so that audit is vacuous for them -- while the development and
// CI tooling (which runs with repository credentials in CI) is where the exposure is. This runs the
// whole-tree audit and the production-only audit and prints both as ONE JSON envelope, so the policy can
// tell a development-only advisory from a runtime one:
//
//   { ok: true, all: <npm audit --json>, production: <npm audit --omit=dev --json> }
//   { ok: false, error }
//
// `npm audit` exits non-zero whenever it finds anything, so the exit code is not an error signal here;
// only unparseable output is. Never exits non-zero itself -- the policy decides.

import { sync as spawnSync } from "cross-spawn"

function audit(extraArgs) {
  const result = spawnSync("npm", ["audit", ...extraArgs, "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error)
    return { error: `${result.error.code ?? "spawn error"}: ${result.error.message}` }
  try {
    return { value: JSON.parse(result.stdout) }
  } catch {
    return {
      error:
        `npm audit ${extraArgs.join(" ")} did not print JSON: ${(result.stderr || result.stdout).slice(0, 300)}`.replace(
          "audit  ",
          "audit ",
        ),
    }
  }
}

const all = audit([])
const production = audit(["--omit=dev"])
const failed = all.error ?? production.error
process.stdout.write(
  JSON.stringify(
    failed === undefined
      ? { ok: true, all: all.value, production: production.value }
      : { ok: false, error: failed },
  ),
)
