#!/usr/bin/env node
// Entry point for the mutation badge (scripts/badges/mutation-badge.mjs): reads a Stryker report and writes the badge JSON.
import { run } from "./badges/mutation-badge.mjs"

process.exitCode = run(process.argv.slice(2), process.cwd(), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
})
