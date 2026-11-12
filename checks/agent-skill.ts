/**
 * `AgentSkill`: the skill files an AI agent loads for this package are what
 * `internal-package-contract skill` would write now.
 *
 * Reads: `docs/skill.json` and the files under `skills/<name>/`, through
 * `scripts/check-agent-skill.mjs` and `scripts/skill/inspect.mjs`. The rest comes from what the
 * package already says about itself: name, version, exports, API.
 *
 * Fails when `docs/skill.json` is missing or invalid. Fails when the manual is over its word
 * budget. Fails when a written file differs from what would be written now. Never warns. It judges
 * shape and size, never whether the advice is good.
 *
 * Exceptions: none. Run `npx internal-package-contract skill` and commit the result.
 *
 * Not in the standard set: a package turns it on by name in package.json (`add check AgentSkill`).
 * It then runs wherever that package's contract runs, waiting on nothing, since it reads source
 * files only.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-agent-skill.mjs")

interface SkillReport {
  readonly ok: boolean
  readonly state: "none" | "invalid" | "checked"
  readonly problems: readonly string[]
  readonly stale: readonly string[]
  readonly words: number
  readonly budget: number
}

/** @returns the `AgentSkill` check. */
export function agentSkillCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<SkillReport>(result, "check-agent-skill", "AgentSkill:")
      if (!envelope.ok) return envelope.result
      const { state, problems, stale, words, budget } = envelope.value
      if (state !== "checked" || problems.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            "AgentSkill: the skill cannot be written from docs/skill.json:",
            ...problems.map((line) => `- ${line}`),
          ].join("\n"),
        }
      }
      if (stale.length > 0) {
        return {
          outcome: "fail",
          rationale: `AgentSkill: ${stale.join(", ")} ${stale.length === 1 ? "is" : "are"} not what would be written now. Run \`npx internal-package-contract skill\` and commit the result.`,
        }
      }
      return {
        outcome: "pass",
        rationale: `AgentSkill: the skill is current, at ${String(words)} of ${String(budget)} words.`,
      }
    },
  }
}
