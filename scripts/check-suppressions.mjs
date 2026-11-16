// Entry point for the `Suppressions` check (see checks/suppressions.ts). Finds every suppression
// comment in the repository (scripts/suppressions-scan.mjs) and prints one JSON envelope: `{ ok:
// true, files, suppressions }`, or `{ ok: false, error }` when the scan itself failed. The contract
// keeps that stdout as evidence. Every rule the repository tells a tool to ignore is then part of
// each run's record, beside the verdict. The policy decides the verdict.

import { scanRepository } from "./suppressions-scan.mjs"

try {
  const { files, suppressions } = scanRepository(process.cwd())
  process.stdout.write(JSON.stringify({ ok: true, files, suppressions }))
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
}
