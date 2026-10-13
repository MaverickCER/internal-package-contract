import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { agentSkillCheck } from "../checks/agent-skill.js"
import { planAddCheck } from "../scripts/recipes/add-check.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const judge = (value: unknown) => agentSkillCheck().policy(makeContext(makeJsonResult(value)))
const report = { ok: true, state: "checked", problems: [], stale: [], words: 412, budget: 600 }

describe("agentSkillCheck (policy)", () => {
  it("runs the bundled script and asks for JSON", () => {
    const check = agentSkillCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-agent-skill\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes a current skill, saying how much of its budget it uses", async () => {
    expect(await judge(report)).toEqual({
      outcome: "pass",
      rationale: "AgentSkill: the skill is current, at 412 of 600 words.",
    })
  })
  it("fails a skill that cannot be written, listing why", async () => {
    expect(await judge({ ...report, state: "invalid", problems: ["a", "b"] })).toEqual({
      outcome: "fail",
      rationale: "AgentSkill: the skill cannot be written from docs/skill.json:\n- a\n- b",
    })
    expect(
      await judge({ ...report, state: "none", problems: ["there is no docs/skill.json"] }),
    ).toEqual({
      outcome: "fail",
      rationale:
        "AgentSkill: the skill cannot be written from docs/skill.json:\n- there is no docs/skill.json",
    })
  })
  it("does not pass a skill that was never checked, even with nothing to say", async () => {
    expect((await judge({ ...report, state: "none", problems: [] })).outcome).toBe("fail")
  })
  it("fails a checked skill that still has problems, such as being over budget", async () => {
    const over = await judge({ ...report, problems: ["the manual is 700 words"] })
    expect(over.outcome).toBe("fail")
    expect(over.rationale).toContain("- the manual is 700 words")
  })
  it("fails a skill that is not what would be written now, naming the files", async () => {
    expect(await judge({ ...report, stale: ["skills/p/SKILL.md"] })).toEqual({
      outcome: "fail",
      rationale:
        "AgentSkill: skills/p/SKILL.md is not what would be written now. Run `npx internal-package-contract skill` and commit the result.",
    })
    expect((await judge({ ...report, stale: ["a", "b"] })).rationale).toContain("a, b are not what")
  })
  it("fails closed on a run that did not finish, or output that is not the envelope", async () => {
    const stuck = await agentSkillCheck().policy(makeContext(makeResult({ status: "timed_out" })))
    expect(stuck.rationale).toBe("check-agent-skill did not run to completion (status: timed_out).")
    const bad = await agentSkillCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("AgentSkill: output could not be parsed as JSON.\noops")
  })
})

describe("the check's entry script", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "skill-check-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("prints the envelope for a package that has no skill, and writes nothing", () => {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "p", version: "1.0.0" }))
    const script = (agentSkillCheck().run as readonly string[])[1] as string
    const result = spawnSync("node", [script], { cwd: dir, encoding: "utf8" })
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>
    expect(envelope).toMatchObject({ ok: true, state: "none", stale: [], words: 0 })
    expect(envelope["problems"]).toHaveLength(1)
    expect(result.status).toBe(0)
  })
})

describe("add check AgentSkill", () => {
  it("names the check and writes no settings, because it reads none", () => {
    const result = planAddCheck({ name: "AgentSkill", packageJson: '{"name": "p"}' })
    expect(result.problems).toEqual([])
    expect(JSON.parse(result.text ?? "{}")).toEqual({
      name: "p",
      "internal-package-contract": { checks: ["AgentSkill"] },
    })
  })
})
