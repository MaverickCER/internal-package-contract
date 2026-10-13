// Entry point for the `EnvContract` check (see checks/env-contract.ts). Prints one JSON envelope; never exits
// non-zero for a finding (policy decides).
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
