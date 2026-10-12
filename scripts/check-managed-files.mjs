// Entry point for the `ManagedFiles` check (see checks/managed-files.ts). Prints one JSON envelope; never
// exits non-zero for a finding (policy decides).
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inspectManaged } from "./managed-files/inspect.mjs"

const cwd = process.cwd()
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = path.join(cwd, "package.json")
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath).toString()) : {}
let report
if (manifest.private === true) {
  report = { state: "exempt", files: [] }
} else {
  const files = inspectManaged({ cwd, packageRoot, pins: { ipcRef: "", ipcSha: "" } })
    .filter(({ state }) => state !== "current")
    .map(({ to, state }) => ({ to, state }))
  report = { state: files.length === 0 ? "current" : "problem", files }
}
process.stdout.write(JSON.stringify({ ok: true, ...report }))
