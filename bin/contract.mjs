#!/usr/bin/env node
// The executable this standard ships: `internal-package-contract`.
//
// With no command it runs the consumer's contract. The checks come from `contract.ts`, resolved next to this
// file, so the definition is always the installed package's. The working directory is never overridden, so
// every check reads the consumer's repository. The package owns the contract; the consumer owns the context.
//
// A command word dispatches to its script under `scripts/`. `scripts/contract-help.mjs` holds the one table of
// commands and options; `--help` prints it, and `SurfaceContract` baselines it. A word that is neither an option
// nor a command is refused, because a typo would otherwise start a run that can take hours.
//
// A consumer's package.json needs only `{ "scripts": { "contract": "internal-package-contract" } }`.
//
// The run flags are `--checks a,b` / `--skip a,b`, `--scope affected|full|auto` with `--base <ref>`, `--changed`,
// `--strict` / `--no-strict`, `--json` and `--logs <mode>`. `scripts/contract-run.mjs` and the modules it imports
// read them. The executors the checks spawn live in this package's own node_modules/.bin when it is a `file:`
// dependency, so every node_modules/.bin above this file is put on PATH first.

import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { commandHelp, helpText, unknownCommand, wantsHelp } from "../scripts/contract-help.mjs"
import { runContract } from "../scripts/contract-run.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Subcommand dispatch.
if (unknownCommand(process.argv.slice(2)) !== undefined) {
  process.stderr.write(unknownCommand(process.argv.slice(2)))
  process.exitCode = 1
} else if (wantsHelp(process.argv.slice(2))) {
  process.stdout.write(commandHelp(process.argv[2]) ?? helpText())
} else if (process.argv[2] === "init") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "init", "run.mjs")).href
  )
  process.exitCode = run(
    process.argv.slice(3),
    process.cwd(),
    {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    },
    { packageRoot },
  )
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
} else if (process.argv[2] === "add") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "recipes", "apply.mjs")).href
  )
  process.exitCode = run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "promote") {
  const { promote } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "adoption", "mode.mjs")).href
  )
  const config = await loadContractConfig()
  process.exitCode = promote(process.argv.slice(3), process.cwd(), Object.keys(config.checks), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "generate") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "generate", "run.mjs")).href
  )
  process.exitCode = await run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "env") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "env", "run.mjs")).href
  )
  process.exitCode = await run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "skill") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "skill", "run.mjs")).href
  )
  process.exitCode = run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "mutation") {
  process.argv.splice(2, 1)
  await import(pathToFileURL(path.join(packageRoot, "scripts", "run-mutation-changed.mjs")).href)
} else if (process.argv[2] === "report") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "report", "run.mjs")).href
  )
  process.exitCode = run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "verify-consumers") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "verify-consumers", "run.mjs")).href
  )
  process.exitCode = run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "tool") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "package-tools", "index.mjs")).href
  )
  process.exitCode = await run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "doctor") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "doctor", "run.mjs")).href
  )
  process.exitCode = await run(process.argv.slice(3), process.cwd(), packageRoot, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "new") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "new", "adr.mjs")).href
  )
  process.exitCode = run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "upgrade") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "upgrade", "run.mjs")).href
  )
  process.exitCode = run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "sync") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "managed-files", "sync.mjs")).href
  )
  process.exitCode = run(process.argv.slice(3), process.cwd(), packageRoot, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "site") {
  const { run } = await import(
    pathToFileURL(path.join(packageRoot, "scripts", "site", "render-site.mjs")).href
  )
  process.exitCode = await run(process.argv.slice(3), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
} else if (process.argv[2] === "install-hooks") {
  await import(pathToFileURL(path.join(packageRoot, "bin", "install-hooks.mjs")).href)
} else if (process.argv[2] === "update-baseline") {
  await import(pathToFileURL(path.join(packageRoot, "bin", "update-baseline.mjs")).href)
  // update-baseline sets its own exit behaviour; nothing else to do here.
} else {
  try {
    await runConsumerContract()
  } catch (error) {
    // A mistake in how the command was typed is told in one line; anything else keeps its stack.
    if (!(error instanceof Error) || error.usage !== true) throw error
    process.stderr.write(`internal-package-contract: ${error.message}\n`)
    process.exitCode = 1
  }
}

async function runConsumerContract() {
  const { runRepoContract } = await import("repo-contract")

  // The checks spawn the executors this package owns (prettier, eslint, tsc,
  // vitest, publint, attw, licensee, secretlint, knip, jscpd, depcruise,
  // crap4ts, stryker, actionlint, linkinator, markdownlint-cli2). When this
  // package is a plain `file:` devDependency of a standalone repo (not an npm
  // workspace), npm symlinks it but does NOT hoist its dependencies. Those
  // executors then live only in THIS package's own node_modules/.bin, not on the
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

  const config = await loadContractConfig()

  await runContract({
    runRepoContract,
    config,
    cwd: process.cwd(),
    title: "internal-package-contract",
  })
}

/** @returns {Promise<{ checks: Record<string, unknown> }>} this package's contract, whose checks a consumer runs. */
async function loadContractConfig() {
  const configUrl = pathToFileURL(path.join(packageRoot, "contract.ts")).href
  const { register } = await import("tsx/esm/api")
  const unregister = register()
  const { default: config } = await import(configUrl)
  await unregister()
  return config
}
