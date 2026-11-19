import { existsSync, readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { auditCiJobs, ciJobsOptions } from "./_ipc/ci-jobs.js"

// Every job of the CI workflow that the ruleset does not require by name is waited for by the `required` job, so
// a job added to the workflow cannot be advisory by omission. A job that is not a gate is named in package.json
// under `"internal-package-contract": { "ciJobs": { "exempt": [...] } }`, which is a reviewed decision.
// The three packages name the workflow ci.yml; a package scaffolded by `init` names it contract.yml.
const workflow = existsSync(".github/workflows/ci.yml")
  ? ".github/workflows/ci.yml"
  : ".github/workflows/contract.yml"

it("every gate job in the CI workflow blocks a merge through the required job", () => {
  const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"))
  expect(auditCiJobs(readFileSync(workflow, "utf8"), ciJobsOptions(manifest))).toEqual([])
})
