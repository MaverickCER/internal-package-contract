#!/usr/bin/env node
// Entry point for the `CleanCheckout` check (see checks/clean-checkout.ts): prints one JSON envelope.

import { checkCleanCheckout } from "./clean-checkout/run.mjs"

process.stdout.write(JSON.stringify({ ok: true, ...checkCleanCheckout(process.cwd()) }))
