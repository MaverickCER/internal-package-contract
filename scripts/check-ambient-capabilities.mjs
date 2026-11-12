#!/usr/bin/env node
// Entry point for the `AmbientCapabilities` check (see checks/ambient-capabilities.ts). Reads the tarball
// npm would publish, through scripts/ambient/inspect.mjs, and prints one JSON envelope with the state and
// the violations. What is forbidden is written in package.json under
// "internal-package-contract"."ambientCapabilities" (see scripts/ambient/scan.mjs). `tool ambient`
// shares the same inspection, so the two cannot disagree.
//
//   node check-ambient-capabilities.mjs [--tarball <file.tgz>]
//
// Without `--tarball` it packs the package in the working directory. The policy decides the verdict.

import { inspectAmbient } from "./ambient/inspect.mjs"

const argv = process.argv.slice(2)
const flag = argv.indexOf("--tarball")
const tarball = flag === -1 ? undefined : argv[flag + 1]

process.stdout.write(
  JSON.stringify({ ok: true, ...inspectAmbient({ cwd: process.cwd(), tarball }) }),
)
