// Entry point for the `ScorecardWorkflow` check (see checks/scorecard-workflow.ts). Reads package.json and
// every `.github/workflows/*.yml` of the working directory and prints one JSON envelope: `exempt` for a
// private package, `problem` when no workflow publishes a Scorecard result (scripts/scorecard/validate.mjs),
// else `current`. The policy decides the verdict.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { validateScorecardWorkflows } from "./scorecard/validate.mjs"

const cwd = process.cwd()
const manifestPath = path.join(cwd, "package.json")
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {}
const dir = path.join(cwd, ".github", "workflows")
let report
if (manifest.private === true) {
  report = { ok: true, state: "exempt" }
} else {
  const workflows = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => /\.ya?ml$/.test(name))
        .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8") }))
    : []
  const problems = validateScorecardWorkflows(workflows)
  report =
    problems.length === 0
      ? { ok: true, state: "current" }
      : { ok: true, state: "problem", message: problems.join("\n") }
}
process.stdout.write(JSON.stringify(report))
