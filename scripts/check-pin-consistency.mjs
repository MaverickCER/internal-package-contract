// Entry point for the `PinConsistency` check (see checks/pin-consistency.ts).
//
// Offline: reads package.json, package-lock.json and .github/workflows/*.yml of the working directory
// and prints one JSON envelope; never exits non-zero for a finding (policy decides).

import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { checkPins } from "./pin-consistency.mjs"

const root = process.cwd()
const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : undefined)
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

const { applies, problems } = checkPins({
  packageJson: read(path.join(root, "package.json")) ?? "{}",
  lockfile: read(path.join(root, "package-lock.json")),
  workflows,
})
process.stdout.write(JSON.stringify({ ok: true, applies, problems }))
