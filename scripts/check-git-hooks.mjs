// Entry point for the `GitHooks` check (see checks/git-hooks.ts). Prints one JSON envelope; never
// exits non-zero for a finding (policy decides).
import { sync as spawnSync } from "cross-spawn"
import { realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { hooksStatus, isCi } from "./git-hooks.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cwd = process.cwd()
const inRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd }).status === 0
const configured = spawnSync("git", ["config", "--get", "core.hooksPath"], {
  cwd,
  encoding: "utf8",
})
const state = hooksStatus({
  ci: isCi(process.env),
  inRepo,
  // A relative core.hooksPath is relative to the repository root, which is where git is run from here.
  configured: configured.status === 0 ? path.resolve(cwd, configured.stdout.trim()) : undefined,
  bundled: path.join(packageRoot, "hooks"),
  realpath: (p) => realpathSync(p),
})
process.stdout.write(JSON.stringify({ ok: true, state }))
