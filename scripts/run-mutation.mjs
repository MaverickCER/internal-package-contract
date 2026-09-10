// Stryker runner for the `Mutation` check.
//
// Mutation testing is part of the standard contract and runs on every
// `npm run contract` -- it is NOT opt-in. It is expensive (minutes to tens of
// minutes on a large `src/`), so the fast hook subsets (pre-commit, pre-push)
// deliberately omit it by name; a consumer that wants a fast local loop runs an
// explicit subset (`internal-package-contract --checks Format,Lint,...`). The
// full contract -- CI, `prepush`/`prepublishOnly` when wired that way, and a
// bare `npm run contract` -- always includes it.
//
// Uses the consumer's own `stryker.config.*` when present; otherwise the bundled
// baseline passed as `--fallback-config`.
//
// Stryker copies the whole project into `.stryker-tmp/sandbox-*/` (hundreds of
// MB); this wrapper always cleans it, and `bin/contract.mjs` cleans it again.
//
// Usage: node run-mutation.mjs --fallback-config <abs path>

import { sync as spawnSync } from "cross-spawn"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"

for (let dir = import.meta.dirname; ;) {
  const bin = path.join(dir, "node_modules", ".bin")
  if (existsSync(bin)) process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}

const CONFIG_CANDIDATES = [
  "stryker.config.mjs",
  "stryker.config.js",
  "stryker.config.cjs",
  "stryker.config.json",
  "stryker.conf.mjs",
  "stryker.conf.js",
  "stryker.conf.json",
  ".stryker.conf.json",
]

const fallbackIdx = process.argv.indexOf("--fallback-config")
const fallbackConfig = fallbackIdx === -1 ? undefined : process.argv[fallbackIdx + 1]

const ownConfig = CONFIG_CANDIDATES.some((c) => existsSync(path.join(process.cwd(), c)))

const args = ["run", "--reporters", "json,clear-text"]
if (!ownConfig && fallbackConfig) args.push(fallbackConfig)

const result = spawnSync("stryker", args, { stdio: "inherit" })

try {
  rmSync(path.join(process.cwd(), ".stryker-tmp"), { recursive: true, force: true })
} catch {
  // best effort -- bin/contract.mjs cleans it too
}

if (result.error) throw result.error
process.exitCode = typeof result.status === "number" ? result.status : 1
