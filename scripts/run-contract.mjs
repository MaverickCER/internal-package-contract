#!/usr/bin/env node
// The thin script `npm run contract` invokes for THIS package's own
// self-hosting run (see repo-contract.config.ts's own doc comment for why
// that file, not contract.ts, is loaded here). Imports the installed
// `repo-contract` package's public API -- this package ships no `dist/` of
// its own to import instead -- and runs it against repo-contract.config.ts.
//
// `--checks a,b` / `--only a,b` restrict the run, exactly like bin/contract.mjs
// offers a consumer. Never calls `process.exit()` directly, only sets
// `process.exitCode`, matching repo-contract's own run-repo-contract.ts.

import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runRepoContract } from "repo-contract"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const checksArg = process.argv.find((a) => a.startsWith("--checks=") || a.startsWith("--only="))
let only
const flagIdx = process.argv.findIndex((a) => a === "--checks" || a === "--only")
if (checksArg) only = checksArg.split("=")[1]
else if (flagIdx !== -1) only = process.argv[flagIdx + 1]
const checkIds = only
  ? only
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : undefined

const configUrl = pathToFileURL(path.join(root, "repo-contract.config.ts")).href
const { register } = await import("tsx/esm/api")
const unregister = register()
const { default: config } = await import(configUrl)
await unregister()

// Checks generate artifacts in this repo's own tree: `reports/`, `coverage/`,
// and Stryker's `.stryker-tmp/` (a multi-hundred-MB sandbox copy). Left
// behind, these trip the NEXT run's Lint/Format/DeadCode -- same reasoning,
// same cleanup, as bin/contract.mjs applies for a consumer's repo.
const alwaysRemove = [".stryker-tmp"]
const removeIfCreated = ["reports", "coverage"].filter((d) => !existsSync(path.join(root, d)))

let verdict
try {
  ;({ verdict } = await runRepoContract(config, checkIds ? { checks: checkIds } : undefined))
} finally {
  for (const dir of [...alwaysRemove, ...removeIfCreated]) {
    rmSync(path.join(root, dir), { recursive: true, force: true })
  }
}

process.stdout.write(
  `\ninternal-package-contract self-check${checkIds ? ` (${checkIds.join(", ")})` : ""}\n\n`,
)
for (const [id, result] of Object.entries(verdict.checks)) {
  process.stdout.write(`[${result.outcome.toUpperCase()}] ${id}: ${result.rationale}\n`)
}
process.stdout.write(`\n${verdict.passed ? "PASS" : "FAIL"}\n`)
process.exitCode = verdict.passed ? 0 : 1
