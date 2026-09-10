#!/usr/bin/env node
// The runnable entry point this standard ships:
//
//   internal-package-contract              run the whole contract
//   internal-package-contract --checks a,b run only checks a, b (and their deps)
//   internal-package-contract init         scaffold repo files + git wiring
//
// A consuming package's package.json only needs
// `{ "scripts": { "contract": "internal-package-contract" } }`.
//
// The one load-bearing detail: contract.ts is resolved relative to THIS file (so
// the definition always comes from the installed package), but runRepoContract is
// called with NO cwd override, so every check defaults to process.cwd() -- the
// consumer's repository. The package owns the contract; the consumer owns the
// execution context.

import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Subcommand dispatch.
if (process.argv[2] === "init") {
  await import(pathToFileURL(path.join(packageRoot, "bin", "init.mjs")).href)
  // init sets its own exit behaviour; nothing else to do here.
} else {
  await runContract()
}

async function runContract() {
  const { runRepoContract } = await import("repo-contract")

  // The checks spawn the executors this package owns (prettier, eslint, tsc,
  // vitest, publint, attw, licensee, secretlint, knip, jscpd, depcruise,
  // crap4ts, stryker, actionlint, linkinator, markdownlint-cli2). When this
  // package is a plain `file:` devDependency of a standalone repo (not an npm
  // workspace), npm symlinks it but does NOT hoist its dependencies, so those
  // executors live only in THIS package's own node_modules/.bin -- not on the
  // PATH npm set up for `npm run contract`. Prepend every node_modules/.bin
  // between this file and the filesystem root so the executors resolve wherever
  // npm actually placed them.
  const binDirs = []
  for (let dir = packageRoot; ;) {
    const bin = path.join(dir, "node_modules", ".bin")
    if (existsSync(bin)) binDirs.push(bin)
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (binDirs.length > 0) {
    process.env.PATH = [...binDirs, process.env.PATH ?? ""].join(path.delimiter)
  }

  // `--checks a,b,c` / `--only a,b,c` -> restrict the run.
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

  const configUrl = pathToFileURL(path.join(packageRoot, "contract.ts")).href
  const { register } = await import("tsx/esm/api")
  const unregister = register()
  const { default: config } = await import(configUrl)
  await unregister()

  // Checks generate artifacts in the consumer's tree: `reports/`, `coverage/`,
  // and Stryker's `.stryker-tmp/` (multi-hundred-MB sandbox copy). Left behind,
  // these trip the NEXT run's Lint/Format/DeadCode and the consumer's own
  // `prettier --check .`. `.stryker-tmp/` is always removed; `reports/` and
  // `coverage/` only if the consumer had none before this run.
  const cwd = process.cwd()
  const alwaysRemove = [".stryker-tmp"]
  const removeIfCreated = ["reports", "coverage"].filter((d) => !existsSync(path.join(cwd, d)))

  let verdict
  try {
    ;({ verdict } = await runRepoContract(config, checkIds ? { checks: checkIds } : undefined))
  } finally {
    for (const dir of [...alwaysRemove, ...removeIfCreated]) {
      rmSync(path.join(cwd, dir), { recursive: true, force: true })
    }
  }

  process.stdout.write(
    `\ninternal-package-contract${checkIds ? ` (${checkIds.join(", ")})` : ""}\n\n`,
  )
  for (const [id, result] of Object.entries(verdict.checks)) {
    process.stdout.write(`[${result.outcome.toUpperCase()}] ${id}: ${result.rationale}\n`)
  }
  process.stdout.write(`\n${verdict.passed ? "PASS" : "FAIL"}\n`)
  process.exitCode = verdict.passed ? 0 : 1
}
