// The script behind the `SecurityDevDeps` check (checks/security-dev-deps.ts).
//
// `SecurityDeps` audits what users install (`npm audit --omit=dev`). The published packages here have no runtime
// dependencies, so that audit is vacuous for them, while the development and CI tooling runs with repository
// credentials. This runs the whole-tree audit and the production-only audit, reading the lockfile and the registry.
// It prints both as one JSON envelope, so the policy can tell a development-only advisory from a runtime one:
//
//   { ok: true, all: <npm audit --json>, production: <npm audit --omit=dev --json> }
//   { ok: false, error }
//
// A `critical` development-only advisory fails the check; anything lower warns. There is no registry for either.
// The script always exits 0; the policy decides.

import { sync as spawnSync } from "cross-spawn"
import { auditBothTrees } from "./dev-deps-audit.mjs"

process.stdout.write(JSON.stringify(auditBothTrees(spawnSync)))
