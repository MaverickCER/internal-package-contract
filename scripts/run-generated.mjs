// Runs a consumer npm script that regenerates committed output (schemas, API reports, ...) and reports which
// of the watched paths it changed. The paths are hashed by content before and after, so the answer does
// not depend on git state. The `mustNotChange` form of checks/npm-script.ts runs through this; its policy
// fails when the script exits non-zero or when anything changed.
//
//   node run-generated.mjs <npm-script> <watch-path> [<watch-path> ...]
//
// Prints one JSON line, `{ "ran": bool, "exitCode": n, "changed": [paths] }`, after the script's own
// output, which is inherited. Always exits 0; the policy decides the verdict.

import { sync as spawnSync } from "cross-spawn"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

for (let dir = import.meta.dirname; ;) {
  const bin = path.join(dir, "node_modules", ".bin")
  if (existsSync(bin)) process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}

const [script, ...watchPaths] = process.argv.slice(2)

/** Map of relative-path -> sha256, for every file under `roots`. */
function hashTree(roots) {
  const hashes = {}
  const walk = (abs, rel) => {
    let stat
    try {
      stat = statSync(abs)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(abs).sort()) {
        walk(path.join(abs, entry), path.posix.join(rel, entry))
      }
    } else if (stat.isFile()) {
      hashes[rel] = createHash("sha256").update(readFileSync(abs)).digest("hex")
    }
  }
  for (const root of roots) walk(path.join(process.cwd(), root), root)
  return hashes
}

const before = hashTree(watchPaths)

const result = spawnSync("npm", ["--loglevel=silent", "run", script], { stdio: "inherit" })

const after = hashTree(watchPaths)

const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  .filter((p) => before[p] !== after[p])
  .sort()

process.stdout.write(
  `${JSON.stringify({ ran: !result.error, exitCode: result.status ?? null, changed })}\n`,
)
