// Entry point for the `ReadmeStructure` check (see checks/readme-structure.ts). Prints one JSON envelope;
// never exits non-zero for a finding (policy decides).
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
