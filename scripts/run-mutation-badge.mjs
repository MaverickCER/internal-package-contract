#!/usr/bin/env node
// Entry point for `run-mutation-badge` (see scripts/badges/mutation-badge.mjs).
import { run } from "./badges/mutation-badge.mjs"

process.exitCode = run(process.argv.slice(2), process.cwd(), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
})
