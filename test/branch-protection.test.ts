import { describe, expect, it } from "vitest"
import { branchProtection } from "../checks/branch-protection.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

describe("branch-protection", () => {
  it("fails when gh terminated abnormally, naming gh (not a blank tool name) in the rationale", async () => {
    const result = await branchProtection.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "gh did not run to completion (status: timed_out).",
    })
  })

  it("fails, appending printed output, when the check script's own output could not be parsed as JSON", async () => {
    const result = await branchProtection.policy(
      makeContext(
        makeResult({
          output: { format: "json", success: false, error: "bad" },
          stdout: "raw gh output",
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Branch protection: gh output could not be parsed as JSON.\nraw gh output",
    })
  })

  it("warns (not fails) when gh CLI is not installed", async () => {
    const result = await branchProtection.policy(
      makeContext(
        makeJsonResult({
          ok: false,
          error: "gh CLI not found -- install it to check GitHub branch protection.",
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "warn",
      rationale:
        "Branch protection: gh CLI not found -- install it to check GitHub branch protection.",
    })
  })

  it("warns (not fails) when gh CLI is not authenticated", async () => {
    const result = await branchProtection.policy(
      makeContext(
        makeJsonResult({
          ok: false,
          error:
            "gh CLI is not authenticated -- run `gh auth login` to check GitHub branch protection.",
        }),
      ),
    )
    expect(result.outcome).toBe("warn")
  })

  it("warns (not fails) when the origin remote is not a recognizable GitHub URL", async () => {
    const result = await branchProtection.policy(
      makeContext(
        makeJsonResult({
          ok: false,
          error: "could not resolve a GitHub owner/repo from `git remote get-url origin`.",
        }),
      ),
    )
    expect(result.outcome).toBe("warn")
  })

  it("fails, naming every missing rule, when the default branch has no protection at all", async () => {
    const result = await branchProtection.policy(
      makeContext(
        makeJsonResult({
          ok: true,
          owner: "MaverickCER",
          repo: "data-cap",
          defaultBranch: "main",
          hasDeletion: false,
          hasNonFastForward: false,
          hasPullRequest: false,
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "Branch protection: MaverickCER/data-cap's default branch (main) is missing deletion protection and a pull-request-required rule and force-push protection. Run `internal-package-contract init` to configure it.",
    })
  })

  it("fails, naming only the specific missing rule, when protection is partial", async () => {
    const result = await branchProtection.policy(
      makeContext(
        makeJsonResult({
          ok: true,
          owner: "MaverickCER",
          repo: "env-cap",
          defaultBranch: "main",
          hasDeletion: true,
          hasNonFastForward: true,
          hasPullRequest: false,
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "Branch protection: MaverickCER/env-cap's default branch (main) is missing a pull-request-required rule. Run `internal-package-contract init` to configure it.",
    })
  })

  it("passes when deletion, force-push, and pull-request rules are all present", async () => {
    const result = await branchProtection.policy(
      makeContext(
        makeJsonResult({
          ok: true,
          owner: "MaverickCER",
          repo: "internal-package-contract",
          defaultBranch: "main",
          hasDeletion: true,
          hasNonFastForward: true,
          hasPullRequest: true,
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale:
        "Branch protection: MaverickCER/internal-package-contract's default branch (main) blocks deletion, force-pushes, and merging without a PR.",
    })
  })
})
