#!/usr/bin/env node
// Dispatched from `internal-package-contract update-baseline` (see bin/contract.mjs). Regenerates
// every ApiContract target's `.repo-contract/api-contract/<target>/baseline.*` in the consumer's
// working tree (process.cwd()) for a human -- or CI, on the Changesets "Version Packages" PR
// branch -- to review and commit. See scripts/api-contract/update-baseline.ts's own module comment
// for the full outcome matrix.

import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const { register } = await import("tsx/esm/api")
const unregister = register()
const { runUpdateBaseline } = await import(
  path.join(packageRoot, "scripts", "api-contract", "update-baseline.ts")
)
const outcomes = await runUpdateBaseline(process.cwd())
await unregister()

let failed = false
for (const outcome of outcomes) {
  const line = `[${outcome.target}] ${outcome.message}`
  if (outcome.status === "updated" || outcome.status === "current") {
    process.stdout.write(`${line}\n`)
  } else {
    failed = true
    process.stderr.write(`${line}\n`)
  }
}
process.exitCode = failed ? 1 : 0
