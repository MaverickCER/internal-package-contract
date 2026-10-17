import { describe, expect, it } from "vitest"
import type { CheckDefinitionConfig } from "repo-contract"
import {
  composeCheck,
  evidenceOf,
  evidenceOfAll,
  policiesOfAll,
  policyOf,
  withEvidence,
  withPolicy,
} from "../checks/parts.js"
import { standardChecks } from "../checks/standard.js"

const pass = () => Promise.resolve({ outcome: "pass" as const, rationale: "ok" })
const other = () => Promise.resolve({ outcome: "fail" as const, rationale: "no" })
const check: CheckDefinitionConfig = {
  run: ["node", "x.mjs"],
  output: { format: "json" },
  timeoutMs: 5,
  policy: pass,
}

describe("a check taken apart", () => {
  it("has an evidence half without the policy and a policy half that is the original", () => {
    expect(evidenceOf(check)).toEqual({
      run: ["node", "x.mjs"],
      output: { format: "json" },
      timeoutMs: 5,
    })
    expect("policy" in evidenceOf(check)).toBe(false)
    expect(policyOf(check)).toBe(pass)
  })

  it("is put back together unchanged", () => {
    expect(composeCheck(evidenceOf(check), policyOf(check))).toEqual(check)
  })

  it("keeps the evidence when the policy is replaced", () => {
    const adapted = withPolicy(check, other)
    expect(adapted.policy).toBe(other)
    expect(evidenceOf(adapted)).toEqual(evidenceOf(check))
  })

  it("keeps the policy, and every field not named, when the evidence is replaced", () => {
    const adapted = withEvidence(check, { run: ["node", "y.mjs"] })
    expect(adapted.policy).toBe(pass)
    expect(adapted).toEqual({ ...check, run: ["node", "y.mjs"] })
  })

  it("does not change the check it was given", () => {
    const before = { ...check }
    withEvidence(check, { run: "y" })
    withPolicy(check, other)
    expect(check).toEqual(before)
  })
})

describe("the whole standard taken apart", () => {
  const standard: Record<string, CheckDefinitionConfig> = standardChecks()

  it("splits every check, in order, with nothing lost", () => {
    const evidence = evidenceOfAll(standard)
    const policies = policiesOfAll(standard)
    expect(Object.keys(evidence)).toEqual(Object.keys(standard))
    expect(Object.keys(policies)).toEqual(Object.keys(standard))
    for (const id of Object.keys(standard)) {
      expect("policy" in (evidence[id] ?? {})).toBe(false)
      expect(typeof policies[id]).toBe("function")
      expect(composeCheck(evidence[id]!, policies[id]!)).toEqual(standard[id])
    }
  })
})
