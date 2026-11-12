#!/usr/bin/env node
// Entry point for the `CleanCheckout` check (see checks/clean-checkout.ts). Copies what git tracks to a
// temporary folder and runs the package's own type check there (scripts/clean-checkout/run.mjs), then
// prints one JSON envelope: passed, failed with the output's tail, or skipped with the reason. The policy
// decides the verdict.

import { checkCleanCheckout } from "./clean-checkout/run.mjs"

process.stdout.write(JSON.stringify({ ok: true, ...checkCleanCheckout(process.cwd()) }))
