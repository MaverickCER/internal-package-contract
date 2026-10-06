// Entry point for the `Suppressions` check (see checks/suppressions.ts).
//
// Scans the repository for suppression comments (scripts/suppressions-scan.mjs) and prints ONE JSON
// envelope to stdout -- `{ ok: true, files, suppressions: [...] }` or `{ ok: false, error }`. That
// stdout is kept verbatim in the contract's evidence, so the complete list of every rule this
// repository tells a tool to ignore is part of the record of each run, not only the verdict on it.
// Never exits non-zero for a scan problem; the policy decides.

import { scanRepository } from "./suppressions-scan.mjs"

try {
  const { files, suppressions } = scanRepository(process.cwd())
  process.stdout.write(JSON.stringify({ ok: true, files, suppressions }))
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
}
