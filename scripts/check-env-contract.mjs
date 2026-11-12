// Entry point for the `EnvContract` check (see checks/env-contract.ts). Reads ci/env.schema.ts through
// scripts/env/run.mjs and prints one JSON envelope: the state, how many contracts it documents, the
// findings and the generated files that are stale. A schema that cannot be read is `{ ok: false, message }`,
// which the policy reports as a warning, never a failure. The text of docs/ENVIRONMENT.md is for `env` to
// write, so the envelope carries only what is wrong with it.

import { inspectEnv } from "./env/run.mjs"

try {
  // The text the document should have is for `env` to write, not for the check to carry.
  const { state, contracts, findings, stale } = await inspectEnv({ cwd: process.cwd() })
  process.stdout.write(JSON.stringify({ ok: true, state, contracts, findings, stale }))
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }),
  )
}
