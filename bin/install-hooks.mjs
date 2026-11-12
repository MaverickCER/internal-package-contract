#!/usr/bin/env node
// Entry for `internal-package-contract install-hooks` (dispatched by bin/contract.mjs). It gathers what
// `scripts/install-hooks.mjs` needs from git and the filesystem; the decision is made there. It exits 0 whether
// or not the hooks were installed.
import { sync as spawnSync } from "cross-spawn"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { run } from "../scripts/install-hooks.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cwd = process.cwd()
process.exitCode = run({
  inRepo: spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd }).status === 0,
  installed: existsSync(path.join(cwd, "node_modules", "internal-package-contract", "hooks")),
  packageHooks: path.join(packageRoot, "hooks"),
  prefix: spawnSync("git", ["rev-parse", "--show-prefix"], { cwd }).stdout?.toString().trim() ?? "",
  git: (args) => spawnSync("git", args, { cwd }).status ?? 1,
  write: (text) => process.stdout.write(text),
})
