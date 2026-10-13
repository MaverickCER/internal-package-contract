/**
 * Fails when a benchmark group got worse at big-O than the last release and no human accepted it. The
 * committed benchmark results are compared with the results committed at the last release tag; a group
 * whose fitted complexity class increased (linear to quadratic, say) fails unless a complete, unexpired
 * record in `.repo-contract/exceptions/benchmark-complexity.json` accepts that group growing to that class.
 * Writing the record is the review: it states the rule being broken, what was tried, the constraint, why
 * the outcome is preferable and what risk remains, so the increase is read before the version ships. A
 * package with no benchmarks, or no release to compare with, has nothing to judge and passes.
 *
 * Example record:
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "benchmark-complexity:performance-runtime:fn:parse:quadratic",
 *       "version": 2,
 *       "justification": "Parsing now compares every pair of declarations to report duplicates.",
 *       "suite": "performance-runtime",
 *       "group": "fn:parse",
 *       "to": "quadratic",
 *       "ruleBroken": "Parsing scales linearly with the number of declarations.",
 *       "attempted": "A hash-based duplicate check was prototyped and kept ordering bugs.",
 *       "constraint": "Declaration ordering must be preserved for the generated manifest.",
 *       "whyPreferable": "Real inputs stay under 200 declarations, where the pairwise check costs microseconds.",
 *       "residualRisk": "A generated schema with thousands of declarations would parse visibly slower.",
 *       "revisitWhen": "Any input above 1000 declarations is reported, or the ordering requirement changes.",
 *       "expires": ""
 *     }
 *   ]
 * }
 * ```
 */
import path from "node:path"
import { loadExceptionRegistry } from "repo-contract/helpers"
import type { ExceptionRecordCore, StandardSchemaV1 } from "repo-contract/helpers"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import {
  classRank,
  describeGain,
  gainExceptionId,
  judgeGains,
  REGISTRY_RELATIVE_PATH,
} from "../scripts/benchmark/complexity-gain.mjs"
import type { Gain } from "../scripts/benchmark/complexity-gain.mjs"
import { isValidNonEmptyStringField, validateExceptionRegistry } from "./exception-record.js"
import type { ExceptionRegistrySchema, ExceptionV2Fields } from "./exception-record.js"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-benchmark-complexity.mjs")

/** One `.repo-contract/exceptions/benchmark-complexity.json` record. */
export interface BenchmarkComplexityRecord extends Partial<ExceptionV2Fields> {
  readonly id: string
  readonly version: 1 | 2
  readonly justification: string
  readonly suite: string
  readonly group: string
  readonly to: string
}

/** @internal Exported for direct unit coverage. */
export const BENCHMARK_COMPLEXITY_SCHEMA: ExceptionRegistrySchema<BenchmarkComplexityRecord> = {
  namespace: "benchmark-complexity:",
  metadataKeys: ["suite", "group", "to"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const { suite, group, to } = raw
    const suiteValid = isValidNonEmptyStringField(suite, `${at}.suite`, errors)
    const groupValid = isValidNonEmptyStringField(group, `${at}.group`, errors)
    const toValid = isValidNonEmptyStringField(to, `${at}.to`, errors)
    if (!suiteValid || !groupValid || !toValid) return undefined
    if (classRank(to) < 0) {
      errors.push(`${at}.to ${JSON.stringify(to)} is not a complexity class.`)
      return undefined
    }
    const derived = gainExceptionId(suite, group, to)
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own suite, group and class (${JSON.stringify(derived)}).`,
      )
      return undefined
    }
    return { id: core.id, version: 1, justification: core.justification, suite, group, to }
  },
}

const registrySchema: StandardSchemaV1<unknown, readonly BenchmarkComplexityRecord[]> = {
  "~standard": {
    version: 1,
    vendor: "internal-package-contract",
    validate: (value: unknown) => {
      const result = validateExceptionRegistry(value, BENCHMARK_COMPLEXITY_SCHEMA)
      return result.ok
        ? { value: result.records }
        : { issues: result.errors.map((message) => ({ message })) }
    },
  },
}

interface ScanReport {
  readonly ok: boolean
  readonly state: "none" | "no-baseline" | "compared"
  readonly tag: string | null
  readonly suites: readonly string[]
  readonly gains: readonly Gain[]
  readonly undetermined?: readonly {
    suite: string
    group: string
    variable?: string
    reason: string
  }[]
}

/**
 * @param input - Test seam: the clock and repository root the registry is read against.
 * @param input.cwd - The repository root; defaults to the working directory.
 * @param input.now - The clock `expires` is compared against; defaults to now.
 * @returns the `BenchmarkComplexity` check.
 */
export function benchmarkComplexityCheck(
  input: { readonly cwd?: string; readonly now?: Date } = {},
): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: async ({ result }): Promise<PolicyResult> => {
      const envelope = parseToolEnvelope<ScanReport>(
        result,
        "check-benchmark-complexity",
        "BenchmarkComplexity:",
      )
      if (!envelope.ok) return envelope.result
      const { state, tag, suites, gains, undetermined = [] } = envelope.value
      // Nothing is known to be wrong about a group whose big-O could not be determined, but nothing is
      // checked either, so it is told, never failed. A real failure below still leads.
      const unknown =
        undetermined.length === 0
          ? []
          : [
              `${String(undetermined.length)} benchmark group(s) have a big-O that could not be determined, so they are not checked against their documentation:`,
              ...undetermined.map(
                ({ suite, group, variable, reason }) =>
                  `- ${suite} / ${group}${variable === undefined ? "" : ` (varying ${variable})`}: ${reason}`,
              ),
            ]
      const warnIfUnknown = (rationale: string): PolicyResult =>
        unknown.length === 0
          ? { outcome: "pass", rationale }
          : { outcome: "warn", rationale: [rationale, ...unknown].join("\n") }
      if (state === "none") {
        return {
          outcome: "pass",
          rationale:
            "BenchmarkComplexity: this package has no committed benchmark results to compare.",
        }
      }
      if (state === "no-baseline") {
        return warnIfUnknown(
          "BenchmarkComplexity: no release tag exists yet, so there is no released complexity to compare with.",
        )
      }
      if (gains.length === 0) {
        return warnIfUnknown(
          `BenchmarkComplexity: no benchmark group got worse at big-O across ${String(suites.length)} suite(s) since ${String(tag)}.`,
        )
      }
      const loaded = await loadExceptionRegistry({
        path: path.join(input.cwd ?? process.cwd(), REGISTRY_RELATIVE_PATH),
        schema: registrySchema,
      })
      if (!loaded.ok) {
        return {
          outcome: "fail",
          rationale: [
            `BenchmarkComplexity: ${REGISTRY_RELATIVE_PATH} failed to load, so a complexity increase cannot be judged:`,
            ...loaded.errors.map((error) => `- ${error}`),
          ].join("\n"),
        }
      }
      const judged = judgeGains(
        gains,
        loaded.records as unknown as readonly Record<string, unknown>[],
        input.now ?? new Date(),
      )
      if (judged.unaccepted.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            `BenchmarkComplexity: ${String(judged.unaccepted.length)} benchmark group(s) got worse at big-O since ${String(tag)} and no human has accepted it. Fix the regression, or review it and record the decision in ${REGISTRY_RELATIVE_PATH}:`,
            ...judged.unaccepted.map(
              ({ gain, id, reason }) =>
                `- ${describeGain(gain)}; add or complete ${id} (${reason})`,
            ),
            ...unknown,
          ].join("\n"),
        }
      }
      return warnIfUnknown(
        [
          `BenchmarkComplexity: ${String(judged.accepted.length)} complexity increase(s) since ${String(tag)}, each accepted by a reviewed record:`,
          ...judged.accepted.map(({ gain, id }) => `- ${describeGain(gain)} (${id})`),
        ].join("\n"),
      )
    },
  }
}
