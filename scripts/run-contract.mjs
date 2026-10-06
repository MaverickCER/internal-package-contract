#!/usr/bin/env node
// The thin script `npm run contract` invokes for THIS package's own
// self-hosting run (see repo-contract.config.ts's own doc comment for why
// that file, not contract.ts, is loaded here). Imports the installed
// `repo-contract` package's public API -- this package ships no `dist/` of
// its own to import instead -- and runs it against repo-contract.config.ts.
//
// `--checks a,b` / `--only a,b` / `--skip a,b` / `--strict` behave exactly as
// bin/contract.mjs offers a consumer (the run loop is shared:
// scripts/contract-run.mjs). Never calls `process.exit()` directly, only sets
// `process.exitCode`, matching repo-contract's own run-repo-contract.ts.

import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runRepoContract } from "repo-contract"
import { runContract } from "./contract-run.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const configUrl = pathToFileURL(path.join(root, "repo-contract.config.ts")).href
const { register } = await import("tsx/esm/api")
const unregister = register()
const { default: config } = await import(configUrl)
await unregister()

await runContract({
  runRepoContract,
  config,
  cwd: root,
  title: "internal-package-contract self-check",
})
