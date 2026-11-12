#!/usr/bin/env node
// `npm run contract` for THIS repository: its own self-contract. It loads `repo-contract.config.ts` (not
// `contract.ts`, the product a consumer runs; that file's header says why) through tsx and runs it with the
// installed `repo-contract` engine. The run loop is `scripts/contract-run.mjs`, shared with `bin/contract.mjs`,
// so `--checks`, `--skip`, `--scope`, `--strict` and the rest behave the same here. The pre-commit and pre-push
// hooks reach this through `npm run`, because only npm puts node_modules/.bin on PATH for the plain command
// names the config spawns. Only `process.exitCode` is set; `process.exit()` is never called.

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
