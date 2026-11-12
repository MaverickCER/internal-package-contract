// Entry point for the `ManagedFiles` check (see checks/managed-files.ts). Compares every file this package
// owns in a consumer, and every managed copy the consumer enrolled, with the template here
// (scripts/managed-files/inspect.mjs), and prints one JSON envelope listing only the files that are missing
// or drifted. The pins are left blank because a consumer's own workflow carries the pin that is compared.
// A private package is `exempt` before anything is compared. The policy decides the verdict.

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
