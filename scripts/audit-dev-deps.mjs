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
import { auditBothTrees } from "./dev-deps-audit.mjs"

process.stdout.write(JSON.stringify(auditBothTrees(spawnSync)))
