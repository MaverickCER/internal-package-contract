// Entry point for the remote pin audit (see pin-audit.mjs). Needs the network and an authenticated
// `gh`; without them it exits 2 ("blocked"), which is not a pass.
//
//   node node_modules/internal-package-contract/scripts/audit-pins.mjs
//
// Exit codes: 0 every pin is real, 1 a pin is not, 2 blocked.

import { execFile } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { run } from "./pin-audit.mjs"

const execFileAsync = promisify(execFile)

async function gh(apiPath) {
  try {
    const { stdout } = await execFileAsync("gh", ["api", apiPath])
    return { ok: true, status: 200, json: JSON.parse(stdout) }
  } catch (error) {
    const message = String(error?.stderr ?? error?.message ?? "")
    const status = Number(/HTTP (\d{3})/.exec(message)?.[1] ?? 0)
    return { ok: false, status }
  }
}

const root = process.cwd()
const lockPath = path.join(root, "package-lock.json")
const workflowDir = path.join(root, ".github", "workflows")
const workflows = existsSync(workflowDir)
  ? readdirSync(workflowDir)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => ({
        file: `.github/workflows/${name}`,
        text: readFileSync(path.join(workflowDir, name), "utf8"),
      }))
  : []

process.exitCode = await run({
  lockfile: existsSync(lockPath) ? readFileSync(lockPath, "utf8") : undefined,
  workflows,
  gh,
  io: { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) },
})
