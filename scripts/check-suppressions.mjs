// Entry point for the `Suppressions` check (see checks/suppressions.ts). Finds every suppression comment in
// the repository (scripts/suppressions-scan.mjs) and prints one JSON envelope: `{ ok: true, files,
// suppressions }`, or `{ ok: false, error }` when the scan itself failed. The contract keeps that stdout as
// evidence, so every rule the repository tells a tool to ignore is part of the record of each run, not
// only the verdict. The policy decides the verdict.

import { scanRepository } from "./suppressions-scan.mjs"

try {
  const { files, suppressions } = scanRepository(process.cwd())
  process.stdout.write(JSON.stringify({ ok: true, files, suppressions }))
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
}
