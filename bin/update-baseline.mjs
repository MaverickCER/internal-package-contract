#!/usr/bin/env node
// Entry for `internal-package-contract update-baseline` (dispatched by bin/contract.mjs). It runs
// `scripts/api-contract/update-baseline.ts` against the working directory. That rewrites every ApiContract
// target's `.repo-contract/api-contract/<target>/baseline.*` and the SurfaceContract baseline in the same run.
// The files are left for a person, or the CI job on the Changesets "Version Packages" branch, to review and
// commit. Each target's outcome is printed; `refused` and `failed` go to stderr and set exit code 1. That file's
// header has the outcome matrix.

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
