/**
 * Proves the skill an AI agent is given for this package is current, and short enough to be worth loading. The
 * package writes what only its author knows (when to use it, what it is not for, the rules, the common mistakes,
 * one example) in docs/skill.json; everything else (name, version, exports, the API) is read from what the
 * package already says about itself, so it cannot drift. The manual is written to skills/<name>/SKILL.md by
 * `internal-package-contract skill`; this fails when what is written is not what would be written now, when
 * docs/skill.json is not valid, or when the manual is over its word budget.
 *
 * It judges shape and size, never whether the advice is good: that is the author's.
 * It is not part of the standard set; a package turns it on (see `add check AgentSkill`).
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
