#!/usr/bin/env node
// The runnable entry point this standard ships:
//
//   internal-package-contract                 run the whole contract
//   internal-package-contract --checks a,b    run only checks a, b (and their deps)
//   internal-package-contract --skip a,b      run every check except a, b
//   internal-package-contract --strict        also fail on a "not evaluated" result no exception covers
//                                             (the default under CI; --no-strict turns it off)
//   internal-package-contract init            scaffold repo files + git wiring
//   internal-package-contract exceptions     list every exception registry: counts by type, legacy, expired
//   internal-package-contract sync-benchmark-guides   copy the canonical benchmark guides into benchmarks/
//   internal-package-contract update-baseline regenerate every ApiContract target's baseline
//
// A consuming package's package.json only needs
// `{ "scripts": { "contract": "internal-package-contract" } }`.
//
// The one load-bearing detail: contract.ts is resolved relative to THIS file (so
// the definition always comes from the installed package), but runRepoContract is
// called with NO cwd override, so every check defaults to process.cwd() -- the
// consumer's repository. The package owns the contract; the consumer owns the
// execution context.

import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runContract } from "../scripts/contract-run.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Subcommand dispatch.
if (process.argv[2] === "init") {
  await import(pathToFileURL(path.join(packageRoot, "bin", "init.mjs")).href)
  // init sets its own exit behaviour; nothing else to do here.
} else if (process.argv[2] === "exceptions") {
  const { runInventory } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "exceptions-inventory.mjs")).href
  )
  runInventory(process.argv.slice(3), process.cwd(), process.stdout)
} else if (process.argv[2] === "sync-benchmark-guides") {
  const { syncGuides } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "benchmark-guides.mjs")).href
  )
  const written = syncGuides(process.cwd())
  process.stdout.write(
    written.length === 0
      ? "Benchmark guides are already identical to the canonical ones.\n"
      : `Updated ${written.join(", ")}.\n`,
  )
} else if (process.argv[2] === "update-baseline") {
  await import(pathToFileURL(path.join(packageRoot, "bin", "update-baseline.mjs")).href)
  // update-baseline sets its own exit behaviour; nothing else to do here.
} else {
  await runConsumerContract()
}

async function runConsumerContract() {
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

  const configUrl = pathToFileURL(path.join(packageRoot, "contract.ts")).href
  const { register } = await import("tsx/esm/api")
  const unregister = register()
  const { default: config } = await import(configUrl)
  await unregister()

  await runContract({
    runRepoContract,
    config,
    cwd: process.cwd(),
    title: "internal-package-contract",
  })
}
