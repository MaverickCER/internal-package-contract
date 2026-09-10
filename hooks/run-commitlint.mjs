// commit-msg hook body: run commitlint against the message file, using the
// consumer's commitlint config if present, else the bundled baseline.

import { sync as spawnSync } from "cross-spawn"
import { existsSync } from "node:fs"
import path from "node:path"

const hooksDir = import.meta.dirname
const packageRoot = path.resolve(hooksDir, "..")

for (let dir = hooksDir; ;) {
  const bin = path.join(dir, "node_modules", ".bin")
  if (existsSync(bin)) process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}

const messageFile = process.argv[2]
if (!messageFile) {
  process.stderr.write("commit-msg hook: no message file\n")
  process.exit(1)
}

const CONFIG_CANDIDATES = [
  "commitlint.config.js",
  "commitlint.config.mjs",
  "commitlint.config.cjs",
  "commitlint.config.ts",
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".commitlintrc.yml",
]
const hasOwn = CONFIG_CANDIDATES.some((c) => existsSync(path.join(process.cwd(), c)))

const args = ["--edit", messageFile]
if (!hasOwn) args.push("--config", path.join(packageRoot, "config", "commitlint.config.mjs"))

const result = spawnSync("commitlint", args, { stdio: "inherit" })
process.exit(typeof result.status === "number" ? result.status : 1)
