import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { auditCiJobs, ciJobsOptions } from "./_ipc/ci-jobs.js"

// Every job of ci.yml that the ruleset does not require by name is waited for by the `required` job, so a job
// added to the workflow cannot be advisory by omission. A job that is not a gate is named in package.json under
// `"internal-package-contract": { "ciJobs": { "exempt": [...] } }`, which is a reviewed decision, not a default.
it("every gate job in ci.yml blocks a merge through the required job", () => {
  const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"))
  expect(
    auditCiJobs(readFileSync(".github/workflows/ci.yml", "utf8"), ciJobsOptions(manifest)),
  ).toEqual([])
})
