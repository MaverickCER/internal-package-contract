// Entry point for the `AdoptionMode` check (see checks/adoption-mode.ts). Reads `.repo-contract/adoption.json`
// through scripts/adoption/mode.mjs and prints one JSON envelope with its state and what it still enforces.
// The policy decides the verdict; nothing here exits non-zero for a finding.

import { readAdoption } from "./adoption/mode.mjs"

process.stdout.write(JSON.stringify({ ok: true, ...readAdoption(process.cwd()) }))
