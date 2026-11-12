// Entry point for the `ReadmeStructure` check (see checks/readme-structure.ts). Reads package.json and
// README.md of the working directory and prints one JSON envelope: `exempt` for a private package, `problem`
// when the README is missing or breaks the shared layout (scripts/readme/validate.mjs), else `current`. The
// policy decides the verdict.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { validateReadme } from "./readme/validate.mjs"

const cwd = process.cwd()
const manifestPath = path.join(cwd, "package.json")
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {}
const readmePath = path.join(cwd, "README.md")
let report
if (manifest.private === true) {
  report = { ok: true, state: "exempt" }
} else if (!existsSync(readmePath)) {
  report = { ok: true, state: "problem", message: "README.md is missing." }
} else {
  const problems = validateReadme(readFileSync(readmePath, "utf8"))
  report =
    problems.length === 0
      ? { ok: true, state: "current" }
      : { ok: true, state: "problem", message: problems.join("\n") }
}
process.stdout.write(JSON.stringify(report))
