// Entry point for the `ScorecardWorkflow` check (see checks/scorecard-workflow.ts). Prints one JSON
// envelope; never exits non-zero for a finding (policy decides).
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
