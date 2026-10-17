// Entry point for the `AdoptionMode` check (see checks/adoption-mode.ts). Prints one JSON envelope; never
// exits non-zero for a finding (policy decides).
import { readAdoption } from "./adoption/mode.mjs"

process.stdout.write(JSON.stringify({ ok: true, ...readAdoption(process.cwd()) }))
