#!/usr/bin/env node
// Entry point for merging the reports of a sharded mutation run (scripts/mutation/merge.mjs).
import { run } from "./mutation/merge.mjs"

process.exitCode = run(process.argv.slice(2), process.cwd(), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
})
