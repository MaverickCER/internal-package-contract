import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  REQUIRED_RULE_TYPES,
  REQUIRED_STATUS_CHECK_CONTEXT,
  mergeRequiredRules,
  resolveOwnerRepo,
  rulesetCoversBranch,
} from "../scripts/github-repo.mjs"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const repoWithOrigin = (origin: string | undefined) => {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-github-repo-"))
  roots.push(root)
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" })
  if (origin !== undefined)
    execFileSync("git", ["remote", "add", "origin", origin], { cwd: root, stdio: "ignore" })
  return root
}

describe("resolveOwnerRepo()", () => {
  it("reads owner and repository from an SSH or an HTTPS remote, with or without .git", () => {
    const expected = { owner: "acme", repo: "widgets" }
    for (const url of [
      "git@github.com:acme/widgets.git",
      "git@github.com:acme/widgets",
      "https://github.com/acme/widgets.git",
      "https://github.com/acme/widgets",
    ]) {
      expect(resolveOwnerRepo(repoWithOrigin(url)), url).toEqual(expected)
    }
  })

  it("keeps dots and dashes in the repository name, and strips only a trailing .git", () => {
    expect(resolveOwnerRepo(repoWithOrigin("git@github.com:a-b/my.repo-name.git"))).toEqual({
      owner: "a-b",
      repo: "my.repo-name",
    })
    expect(resolveOwnerRepo(repoWithOrigin("https://github.com/o/x.github.io"))).toEqual({
      owner: "o",
      repo: "x.github.io",
    })
  })

  it("is undefined without a GitHub origin", () => {
    expect(resolveOwnerRepo(repoWithOrigin(undefined))).toBeUndefined()
    for (const url of [
      "git@gitlab.com:acme/widgets.git",
      "https://gitlab.com/acme/widgets.git",
      "http://github.com/acme/widgets.git",
      "https://github.com/acme",
      "git@github.com:acme",
      "ssh://git@github.com/acme/widgets.git",
      "prefix-git@github.com:acme/widgets.git",
      "prefix-https://github.com/acme/widgets",
    ]) {
      expect(resolveOwnerRepo(repoWithOrigin(url)), url).toBeUndefined()
    }
  })

  it("is undefined outside a repository", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "ipc-github-repo-none-"))
    roots.push(outside)
    expect(resolveOwnerRepo(outside)).toBeUndefined()
  })
})

describe("rulesetCoversBranch()", () => {
  const covers = (include: unknown, branch = "main") =>
    rulesetCoversBranch({ conditions: { ref_name: { include } } } as never, branch)

  it("covers all branches, the default branch, or the branch named by its ref", () => {
    expect(covers(["~ALL"])).toBe(true)
    expect(covers(["~DEFAULT_BRANCH"])).toBe(true)
    expect(covers(["refs/heads/main"])).toBe(true)
    expect(covers(["refs/heads/other", "refs/heads/main"])).toBe(true)
    expect(covers(["refs/heads/develop"], "develop")).toBe(true)
  })

  it("does not cover anything else", () => {
    expect(covers([])).toBe(false)
    expect(covers(["refs/heads/other"])).toBe(false)
    expect(covers(["main"])).toBe(false)
    expect(covers(["refs/heads/main"], "other")).toBe(false)
    expect(covers(["refs/tags/main"])).toBe(false)
    expect(covers(["ALL"])).toBe(false)
  })

  it("covers nothing when the ruleset says nothing about refs", () => {
    expect(rulesetCoversBranch({} as never, "main")).toBe(false)
    expect(rulesetCoversBranch({ conditions: {} } as never, "main")).toBe(false)
    expect(rulesetCoversBranch({ conditions: { ref_name: {} } } as never, "main")).toBe(false)
    expect(rulesetCoversBranch({ conditions: null } as never, "main")).toBe(false)
  })
})

describe("mergeRequiredRules() exactly", () => {
  it("builds each missing rule with its defaults, and says what it added", () => {
    const { rules, changes } = mergeRequiredRules([])
    expect(rules).toEqual([
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: [{ context: "contract" }],
        },
      },
    ])
    expect(changes).toEqual([
      "add deletion",
      "add non_fast_forward",
      "add pull_request",
      "add required_status_checks",
    ])
    expect(REQUIRED_RULE_TYPES).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ])
    expect(REQUIRED_STATUS_CHECK_CONTEXT).toBe("contract")
  })

  it("adds only the rules that are missing, after the ones it keeps, in the required order", () => {
    const { rules, changes } = mergeRequiredRules([{ type: "creation" }, { type: "deletion" }])
    expect(rules.map((r) => r.type)).toEqual([
      "creation",
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ])
    expect(changes).toEqual([
      "add non_fast_forward",
      "add pull_request",
      "add required_status_checks",
    ])
  })

  it("tightens a pull_request rule that has no parameters at all", () => {
    expect(mergeRequiredRules([{ type: "pull_request" }]).rules[0]).toEqual({
      type: "pull_request",
      parameters: { required_review_thread_resolution: true },
    })
    expect(
      mergeRequiredRules([
        { type: "pull_request", parameters: { required_review_thread_resolution: false } },
      ]).changes[0],
    ).toBe("require review threads to be resolved")
    expect(
      mergeRequiredRules([
        { type: "pull_request", parameters: { required_review_thread_resolution: "yes" } },
      ]).changes[0],
    ).toBe("require review threads to be resolved")
  })

  it("leaves a compliant pull_request rule alone, with every other setting as it was", () => {
    const rule = {
      type: "pull_request",
      parameters: { required_review_thread_resolution: true, require_code_owner_review: true },
    }
    const merged = mergeRequiredRules([rule])
    expect(merged.rules[0]).toBe(rule)
    expect(merged.changes).not.toContain("require review threads to be resolved")
  })

  it("does not apply the pull_request defaults to other kinds of rule, nor the status-check ones", () => {
    const { rules } = mergeRequiredRules([{ type: "deletion" }, { type: "non_fast_forward" }])
    expect(rules[0]).toEqual({ type: "deletion" })
    expect(rules[1]).toEqual({ type: "non_fast_forward" })
  })

  it("makes a status-check rule strict and adds the contract context, keeping what was there", () => {
    const strictMissing = mergeRequiredRules([
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: "contract" }],
        },
      },
    ])
    expect(strictMissing.rules[0]?.parameters).toEqual({
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "contract" }],
    })
    expect(strictMissing.changes[0]).toBe("require the contract check (strict)")

    const contextMissing = mergeRequiredRules([
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: true,
          required_status_checks: [{ context: "lint" }],
        },
      },
    ])
    expect(contextMissing.rules[0]?.parameters).toEqual({
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: true,
      required_status_checks: [{ context: "lint" }, { context: "contract" }],
    })
  })

  it("copes with a status-check rule that has no parameters, or no list, or entries that are not objects", () => {
    expect(mergeRequiredRules([{ type: "required_status_checks" }]).rules[0]?.parameters).toEqual({
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "contract" }],
    })
    expect(
      mergeRequiredRules([
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: "nope",
          },
        },
      ]).rules[0]?.parameters,
    ).toMatchObject({ required_status_checks: [{ context: "contract" }] })
    expect(
      mergeRequiredRules([
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [null, undefined, "x", { context: "contract" }],
          },
        },
      ]).changes,
    ).not.toContain("require the contract check (strict)")
    expect(
      mergeRequiredRules([
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [null, { context: "other" }],
          },
        },
      ]).rules[0]?.parameters,
    ).toMatchObject({
      required_status_checks: [null, { context: "other" }, { context: "contract" }],
    })
  })

  it("leaves a compliant status-check rule exactly as it was", () => {
    const rule = {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: "contract" }, { context: "lint" }],
      },
    }
    const merged = mergeRequiredRules([rule])
    expect(merged.rules[0]).toBe(rule)
    expect(merged.changes).not.toContain("require the contract check (strict)")
  })
})
