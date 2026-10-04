import { describe, expect, it } from "vitest"
import {
  REQUIRED_RULE_TYPES,
  REQUIRED_STATUS_CHECK_CONTEXT,
  mergeRequiredRules,
} from "../scripts/github-repo.mjs"

const fullRules = mergeRequiredRules([]).rules

describe("mergeRequiredRules()", () => {
  it("builds every required rule from nothing, strict and with thread resolution", () => {
    const { rules, changes } = mergeRequiredRules([])
    expect(rules.map((r) => r.type)).toEqual([...REQUIRED_RULE_TYPES])
    expect(changes).toEqual(REQUIRED_RULE_TYPES.map((t) => `add ${t}`))
    expect(rules.find((r) => r.type === "pull_request")?.parameters).toMatchObject({
      required_review_thread_resolution: true,
      required_approving_review_count: 0,
    })
    expect(rules.find((r) => r.type === "required_status_checks")?.parameters).toEqual({
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      required_status_checks: [{ context: REQUIRED_STATUS_CHECK_CONTEXT }],
    })
  })

  it("is a no-op for an already-compliant ruleset", () => {
    expect(mergeRequiredRules(fullRules)).toEqual({ rules: fullRules, changes: [] })
  })

  it("turns on thread resolution for an existing pull_request rule without touching its other parameters", () => {
    const { rules, changes } = mergeRequiredRules([
      { type: "pull_request", parameters: { required_approving_review_count: 2 } },
    ])
    expect(changes).toContain("require review threads to be resolved")
    expect(rules[0]?.parameters).toEqual({
      required_approving_review_count: 2,
      required_review_thread_resolution: true,
    })
  })

  it("adds the contract context, and strictness, to a required_status_checks rule that lacks them", () => {
    const { rules, changes } = mergeRequiredRules([
      {
        type: "required_status_checks",
        parameters: { required_status_checks: [{ context: "lint" }] },
      },
    ])
    expect(changes).toContain(`require the ${REQUIRED_STATUS_CHECK_CONTEXT} check (strict)`)
    expect(rules[0]?.parameters).toEqual({
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "lint" }, { context: REQUIRED_STATUS_CHECK_CONTEXT }],
    })
  })

  it("only flips strictness when the contract context is already required", () => {
    const { rules } = mergeRequiredRules([
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: REQUIRED_STATUS_CHECK_CONTEXT }],
        },
      },
    ])
    expect(rules[0]?.parameters?.["required_status_checks"]).toEqual([
      { context: REQUIRED_STATUS_CHECK_CONTEXT },
    ])
    expect(rules[0]?.parameters?.["strict_required_status_checks_policy"]).toBe(true)
  })

  it("tolerates a required_status_checks rule with no parameters at all", () => {
    const { rules } = mergeRequiredRules([{ type: "required_status_checks" }])
    expect(rules[0]?.parameters?.["required_status_checks"]).toEqual([
      { context: REQUIRED_STATUS_CHECK_CONTEXT },
    ])
  })
})
