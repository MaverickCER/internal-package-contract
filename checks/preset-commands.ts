/**
 * Governs every external command this package's own `checks/*.ts` files spawn via a `run:`
 * property against a reviewable, file-based exception registry
 * (`.repo-contract/exceptions/preset-commands.json`) -- the reconciled successor to a hand-
 * maintained allowlist, matching repo-contract's own `preset-commands` check (see
 * `scripts/check-preset-commands.mjs`'s own doc comment for the ported scanning logic).
 *
 * The only field a record needs is a non-empty `justification` (the whole review: what
 * capability the command has under the flags this package passes, and why spawning it on a
 * consumer's behalf is acceptable) -- unlike `SecurityDeps`/`SuppressionGovernance`, no
 * category/severity taxonomy, matching repo-contract's own reasoning: there is exactly one bar
 * every spawned command is held to.
 *
 * A `run:` property whose first element is not a statically-resolvable string literal is a
 * structural problem, not a reviewable risk -- it always fails, with no registry entry able to
 * waive it (see `scripts/check-preset-commands.mjs`'s own scan for why: a dynamically-computed
 * command name cannot be reviewed in advance at all).
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type { ExceptionPolicyConfig, ExceptionRecordCore } from "repo-contract/helpers"
import {
  buildRegistrySchema,
  isValidNonEmptyStringField,
  reconcileRegistry,
} from "./exception-record.js"
import type { ExceptionRegistrySchema } from "./exception-record.js"
import { abnormalTermination, packageRoot } from "./shared.js"

const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/preset-commands.json"
const scriptPath = path.join(packageRoot, "scripts", "check-preset-commands.mjs")

interface NonLiteralCommand {
  readonly file: string
  readonly line: number
  readonly detail: string
}

interface PresetCommandFinding {
  readonly id: string
  readonly command: string
  readonly file: string
  readonly line: number
}

interface ScanReport {
  readonly ok: boolean
  readonly findings?: readonly PresetCommandFinding[]
  readonly nonLiteral?: readonly NonLiteralCommand[]
  readonly error?: string
}

/** One `.repo-contract/exceptions/preset-commands.json` record. */
interface PresetCommandExceptionRecord {
  readonly id: string
  readonly version: 1
  readonly justification: string
  readonly command: string
}

function createPresetCommandStub(
  finding: PresetCommandFinding,
  id: string,
): PresetCommandExceptionRecord {
  return { id, version: 1, justification: "", command: finding.command }
}

const PRESET_COMMAND_EXCEPTION_SCHEMA: ExceptionRegistrySchema<PresetCommandExceptionRecord> = {
  namespace: "preset-command:",
  metadataKeys: ["command"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const { command } = raw
    const commandValid = isValidNonEmptyStringField(command, `${at}.command`, errors)
    if (!commandValid) return undefined

    const derived = `preset-command:${command}`
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own command (${JSON.stringify(derived)}).`,
      )
      return undefined
    }

    return { id: core.id, version: 1, justification: core.justification, command }
  },
}

const registrySchema = buildRegistrySchema(PRESET_COMMAND_EXCEPTION_SCHEMA)

/** No taxonomy, matching `SecurityDeps`'s own reasoning for a single-bar policy: a spawned command is either justified through the registry or it isn't. */
const REQUIREMENTS = ["justification"]
const PRESET_COMMANDS_POLICY: ExceptionPolicyConfig = {
  "preset-command": { default: { mode: "exception", requirements: [...REQUIREMENTS] } },
}
const VALID_PRESET_COMMANDS_REQUIREMENTS = ["justification"] as const

export const presetCommands: CheckDefinitionConfig = {
  run: ["node", scriptPath],
  output: { format: "json" },
  policy: async ({ result }): Promise<PolicyResult> => {
    const terminated = abnormalTermination(result, "check-preset-commands")
    if (terminated) return { outcome: "fail", rationale: terminated }
    if (!result.output?.success) {
      return {
        outcome: "fail",
        rationale: "check-preset-commands output could not be parsed as JSON.",
      }
    }
    const report = result.output.value as ScanReport
    if (!report.ok) {
      return { outcome: "fail", rationale: report.error ?? "Preset-command discovery failed." }
    }
    const findings = report.findings ?? []
    const nonLiteral = report.nonLiteral ?? []

    const registryPath = path.join(process.cwd(), REGISTRY_RELATIVE_PATH)
    const reconciled = await reconcileRegistry(
      registryPath,
      REGISTRY_RELATIVE_PATH,
      registrySchema,
      findings,
      createPresetCommandStub,
      "PRESET_COMMANDS_POLICY",
      PRESET_COMMANDS_POLICY,
      VALID_PRESET_COMMANDS_REQUIREMENTS,
    )
    if (!reconciled.ok) return reconciled.result
    const { activeRecords, staleRecords, newStubIds } = reconciled.registry

    const activeById = new Map(activeRecords.map((r) => [r.id, r]))
    const nonLiteralLines = nonLiteral.map(
      (nl) => `- ${nl.file}:${String(nl.line)} -- ${nl.detail}`,
    )
    const staleLines = staleRecords.map(
      (record) =>
        `- Stale record in ${REGISTRY_RELATIVE_PATH}: ${JSON.stringify(record.id)} -- no check spawns "${record.command}" any more; delete this entry.`,
    )
    const underjustified = findings.filter(
      (finding) => (activeById.get(finding.id)?.justification.trim().length ?? 0) === 0,
    )
    const underjustifiedLines = underjustified.map(
      (finding) =>
        `- ${finding.command} (${finding.file}:${String(finding.line)}) -- fill in "justification".`,
    )

    if (
      nonLiteralLines.length === 0 &&
      staleLines.length === 0 &&
      underjustifiedLines.length === 0
    ) {
      const suffix =
        newStubIds.length > 0
          ? ` (${String(newStubIds.length)} new record(s) scaffolded blank in ${REGISTRY_RELATIVE_PATH})`
          : ""
      return {
        outcome: "pass",
        rationale: `${String(findings.length)} preset command(s), each backed by a reviewed record.${suffix}`,
      }
    }

    return {
      outcome: "fail",
      rationale: [
        `${String(nonLiteralLines.length + staleLines.length + underjustifiedLines.length)} preset-command issue(s):`,
        ...nonLiteralLines,
        ...underjustifiedLines,
        ...staleLines,
      ].join("\n"),
    }
  },
}
