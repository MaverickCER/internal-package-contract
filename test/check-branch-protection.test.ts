import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * The script behind the `BranchProtection` check, run for real against a fake `gh` on PATH, so the
 * JSON the policy reads is proven to carry what the policy judges: which rules a covering ruleset has,
 * which contexts it requires, and whether those checks are strict.
 */
const script = path.resolve(__dirname, "../scripts/check-branch-protection.mjs")

let cwd: string
let binDir: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-check-branch-protection-"))
  binDir = path.join(cwd, "bin")
  mkdirSync(binDir)
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd })
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/widget.git"], { cwd })
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

/** A fake `gh` that answers each `gh api <url>` with `answers[url]` and exits 0 for everything else it is asked. */
function installGh(answers: Record<string, unknown>): void {
  const body = `#!/usr/bin/env node
const answers = ${JSON.stringify(answers)}
if (process.argv[2] !== "api") process.exit(0)
const url = process.argv[3]
if (!(url in answers)) { process.stderr.write("no answer for " + url); process.exit(1) }
const value = answers[url]
process.stdout.write(typeof value === "string" ? value : JSON.stringify(value))
`
  const file = path.join(binDir, "gh")
  writeFileSync(file, body)
  chmodSync(file, 0o755)
}

function run(): Record<string, unknown> {
  const result = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env["PATH"] ?? ""}` },
  })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as Record<string, unknown>
}

const ruleset = (strict: boolean) => ({
  id: 7,
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: { required_review_thread_resolution: true } },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: strict,
        required_status_checks: [{ context: "contract" }, { context: "required" }],
      },
    },
  ],
})

describe.skipIf(process.platform === "win32")("check-branch-protection.mjs", () => {
  it("reports the rules, the required contexts and strictness of the ruleset covering the default branch", () => {
    installGh({
      "repos/acme/widget": "main",
      "repos/acme/widget/rulesets": [{ id: 7, target: "branch", enforcement: "active" }],
      "repos/acme/widget/rulesets/7": ruleset(true),
    })
    expect(run()).toEqual({
      ok: true,
      owner: "acme",
      repo: "widget",
      defaultBranch: "main",
      hasDeletion: true,
      hasNonFastForward: true,
      hasPullRequest: true,
      hasRequiredStatusChecks: true,
      requiredChecks: ["contract", "required"],
      strictStatusChecks: true,
      requiresThreadResolution: true,
      aggregateWorkflow: null,
    })
  })

  it("names the workflow that defines both a contract and a required job, and only such a workflow", () => {
    installGh({
      "repos/acme/widget": "main",
      "repos/acme/widget/rulesets": [{ id: 7, target: "branch", enforcement: "active" }],
      "repos/acme/widget/rulesets/7": ruleset(true),
    })
    const workflows = path.join(cwd, ".github", "workflows")
    mkdirSync(workflows, { recursive: true })
    writeFileSync(path.join(workflows, "broken.yml"), "jobs: [unclosed")
    writeFileSync(path.join(workflows, "lint.yml"), "jobs:\n  required: {}\n")
    writeFileSync(path.join(workflows, "notes.txt"), "jobs:\n  contract: {}\n  required: {}\n")
    expect(run()["aggregateWorkflow"]).toBeNull()
    writeFileSync(path.join(workflows, "ci.yml"), "jobs:\n  contract: {}\n  required: {}\n")
    expect(run()["aggregateWorkflow"]).toBe(".github/workflows/ci.yml")
  })

  it("reports a required-status-checks rule that is not strict as such", () => {
    installGh({
      "repos/acme/widget": "main",
      "repos/acme/widget/rulesets": [{ id: 7, target: "branch", enforcement: "active" }],
      "repos/acme/widget/rulesets/7": ruleset(false),
    })
    const out = run()
    expect(out["hasRequiredStatusChecks"]).toBe(true)
    expect(out["strictStatusChecks"]).toBe(false)
  })

  it("ignores rulesets that are disabled, not branch rulesets, or do not cover the default branch", () => {
    installGh({
      "repos/acme/widget": "main",
      "repos/acme/widget/rulesets": [
        { id: 1, target: "tag", enforcement: "active" },
        { id: 2, target: "branch", enforcement: "disabled" },
        { id: 3, target: "branch", enforcement: "active" },
      ],
      "repos/acme/widget/rulesets/3": {
        ...ruleset(true),
        conditions: { ref_name: { include: ["refs/heads/release"], exclude: [] } },
      },
    })
    const out = run()
    expect(out["hasDeletion"]).toBe(false)
    expect(out["hasRequiredStatusChecks"]).toBe(false)
    expect(out["strictStatusChecks"]).toBe(false)
    expect(out["requiredChecks"]).toEqual([])
  })

  it("says so, instead of guessing, when the repository cannot be read", () => {
    installGh({ "repos/acme/widget/rulesets": [] })
    const out = run()
    expect(out["ok"]).toBe(false)
    expect(out["error"]).toContain("gh api could not read repos/acme/widget")
  })
})
