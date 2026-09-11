/**
 * Mutation testing via Stryker. A generic recreation of repo-contract's own
 * `mutation` check: run Stryker, then require the mutation score (killed vs. all
 * valid mutants, per the Stryker report schema) to meet {@link MUTATION_THRESHOLD}.
 *
 * `isolated: true` (set in contract.ts) is pure scheduling -- Stryker spawns its
 * own worker pool. "Timeout" mutants count as detected; compile/runtime errors
 * and "Ignored" are excluded from the denominator.
 *
 * Part of the standard contract -- runs on every full `npm run contract`, not
 * opt-in. The fast hook subsets (pre-commit, pre-push) omit it by name; a fast
 * local loop is an explicit `--checks ...` subset.
 *
 * Uses the consumer's own `stryker.config.*` when present, otherwise the bundled
 * baseline (`config/stryker.config.mjs`, Vitest runner, `mutate: src/**`). Runs
 * via {@link file://../scripts/run-mutation.mjs}, which always cleans
 * `.stryker-tmp`. `@stryker-mutator/core` + `@stryker-mutator/vitest-runner`
 * ship with this package.
 *
 * ## Known false positives -- `repo-contract/helpers`' exception-policy primitive
 *
 * Stryker's `coverageAnalysis: "perTest"` mode can misreport a mutant as
 * `Survived`/`NoCoverage` even though an existing test genuinely kills it --
 * confirmed by hand-applying the exact mutation to source and re-running the
 * suite (first observed in `@maverickcer/env-cap`'s `resolve-package-schema.ts`
 * `!cached` memoization guard, 2026-09-06: a dedicated "memoizes" test fails
 * when that mutation is applied by hand, yet Stryker's own report lists that
 * same test as covering the mutant and still calls it `Survived`). This is a
 * Stryker measurement defect, not a coverage gap -- no amount of new tests
 * fixes it, because the test that would kill it already exists.
 *
 * A consumer documents a specific instance as a record in
 * `.repo-contract/exceptions/mutation.json` (repo-contract v0.4.0's exception
 * registry convention -- see repo-contract's own
 * specs/decisions/0013-reusable-exception-policy-helper.md):
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "mutation:src/build/resolution/resolve-package-schema.ts:ConditionalExpression:2f8a1c9e4b7d",
 *       "version": 1,
 *       "justification": "Hand-applying this exact mutation fails the \"memoizes\" test (test/build/resolution/resolve-package-schema.test.ts); Stryker's own perTest coverage attribution still reports it Survived. Verified 2026-09-06.",
 *       "file": "src/build/resolution/resolve-package-schema.ts",
 *       "mutator": "ConditionalExpression",
 *       "original": "!cached",
 *       "replacement": "true"
 *     }
 *   ]
 * }
 * ```
 *
 * `checks/exception-record.ts` owns the shared `id`/`version`/`justification`
 * core and registry-shape validation (the layer repo-contract's own ADR 0013
 * deliberately leaves unpublished); `resolveExceptionPolicy`/
 * `evaluateExceptionRecord` (`repo-contract/helpers`) decide whether a matched
 * record's `justification` satisfies policy (non-empty, via a single
 * `{ mode: "exception", requirements: ["justification"] }` policy -- there is
 * no severity tier here the way security findings have one).
 *
 * **Matching and staleness are check-owned, and deliberately do NOT use
 * `repo-contract/helpers`'s `reconcileExceptions`/`writeExceptionRegistry`.**
 * `reconcileExceptions` assumes a run's raw findings are a reasonably stable,
 * deterministic set -- true for dead code, security advisories, disable
 * comments, false for Stryker's own perTest verdicts (confirmed 2026-09-06/07:
 * the exact same mutant flips between `Survived` and `Killed` across
 * successive runs of byte-identical code, and which mutants misreport shifts
 * run to run, sometimes surfacing in files that never showed a false positive
 * before). Feeding "this run's live Survived/NoCoverage mutants" into
 * `reconcileExceptions` as `findings` would scaffold a blank stub for every
 * new flake and mark a good, hand-verified record stale the moment its flake
 * doesn't reproduce -- moving the exact non-determinism this mechanism exists
 * to suppress into the registry's own churn. Instead:
 * - Matching is **structural** -- `file` + `mutator` + the exact `original`/
 *   `replacement` source text Stryker's own report shows for that mutant,
 *   never line/column -- so a record stops matching, and the check fails as
 *   stale, the moment the surrounding code changes even slightly. Two mutants
 *   that happen to share identical text (e.g. the same string-literal error
 *   code returned from several branches) are deliberately covered by one
 *   record -- see this check's own test fixture for a worked example.
 * - A record is stale only when it matches **nothing at all** in the current
 *   report, regardless of status -- never merely because its matches are all
 *   currently `Killed`/`Timeout`. A record matching a currently-non-Survived
 *   mutant just suppresses nothing this run; it is not an error.
 * - No stub is ever auto-scaffolded or auto-written back to the registry: a
 *   record only exists because a human added it after hand verification (see
 *   the false-positive class above). The overall pass/fail still turns on the
 *   aggregate score (`MUTATION_THRESHOLD`), not on "zero unexplained findings"
 *   -- appropriate for a domain this noisy, unlike `DeadCode`'s zero-tolerance
 *   model (a deterministic tool).
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CheckDefinitionConfig, CheckEvidence, PolicyResult } from "repo-contract"
import type {
  ExceptionPolicy,
  ExceptionPolicyConfig,
  ExceptionRecordCore,
} from "repo-contract/helpers"
import {
  evaluateExceptionRecord,
  hashRequirementFields,
  loadExceptionRegistry,
} from "repo-contract/helpers"
import { validateExceptionRegistry } from "./exception-record.js"
import type { ExceptionRegistrySchema } from "./exception-record.js"
import { abnormalTermination, bundledConfig, combinedOutput, packageRoot } from "./shared.js"

/** The minimum mutation score every publishable package must hold. */
export const MUTATION_THRESHOLD = 80

/** Where a consumer's mutation exception registry lives -- the standard `.repo-contract/exceptions/*.json` location every repo-contract v0.4.0+ registry shares. */
const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/mutation.json"

const scriptPath = path.join(packageRoot, "scripts", "run-mutation.mjs")

interface MutantLocation {
  readonly start: { readonly line: number; readonly column: number }
  readonly end: { readonly line: number; readonly column: number }
}
interface Mutant {
  readonly status: string
  readonly mutatorName?: string
  readonly replacement?: string
  readonly location?: MutantLocation
}
interface MutationReportFile {
  readonly mutants?: readonly Mutant[]
  readonly source?: string
}
interface MutationReport {
  readonly files?: Record<string, MutationReportFile>
}

/** One `.repo-contract/exceptions/mutation.json` record: the shared core plus this registry's own identity fields. */
interface MutationExceptionRecord {
  readonly id: string
  readonly version: 1
  readonly justification: string
  readonly file: string
  readonly mutator: string
  readonly original: string
  readonly replacement: string
}

/**
 * The exact source span Stryker's `location` (1-indexed line, 1-indexed,
 * end-exclusive column -- matching Stryker's own reported diffs) refers to,
 * read back out of that same file's own instrumented `source` the report
 * carries. Empty string if the location is missing or out of range, which
 * simply never matches any real registry record.
 */
function extractSpan(source: string | undefined, location: MutantLocation | undefined): string {
  if (source === undefined || location === undefined) return ""
  const lines = source.split("\n")
  const { start, end } = location
  if (start.line === end.line) {
    return lines[start.line - 1]?.slice(start.column - 1, end.column - 1) ?? ""
  }
  const firstLine = lines[start.line - 1]?.slice(start.column - 1) ?? ""
  const middleLines = lines.slice(start.line, end.line - 1)
  const lastLine = lines[end.line - 1]?.slice(0, end.column - 1) ?? ""
  return [firstLine, ...middleLines, lastLine].join("\n")
}

/** A single, resolved mutant: its report status plus the identity fields a {@link MutationExceptionRecord} matches against. */
interface ResolvedMutant {
  readonly file: string
  readonly status: string
  readonly mutator: string
  readonly original: string
  readonly replacement: string
}

function resolveMutants(report: MutationReport): readonly ResolvedMutant[] {
  const resolved: ResolvedMutant[] = []
  for (const [file, fileResult] of Object.entries(report.files ?? {})) {
    for (const mutant of fileResult.mutants ?? []) {
      resolved.push({
        file,
        status: mutant.status,
        mutator: mutant.mutatorName ?? "",
        original: extractSpan(fileResult.source, mutant.location),
        replacement: mutant.replacement ?? "",
      })
    }
  }
  return resolved
}

function matchesRecord(mutant: ResolvedMutant, record: MutationExceptionRecord): boolean {
  return (
    mutant.file === record.file &&
    mutant.mutator === record.mutator &&
    mutant.original === record.original &&
    mutant.replacement === record.replacement
  )
}

/** Reads one of {@link MutationExceptionRecord}'s own string fields -- the `fieldValue` accessor `evaluateExceptionRecord`/`hashRequirementFields` both take. */
function fieldValue(record: MutationExceptionRecord, requirement: string): string {
  const value = (record as unknown as Record<string, unknown>)[requirement]
  return typeof value === "string" ? value : ""
}

/**
 * `mutation:<file>:<mutator>:<12-hex-char digest of original+replacement>` -- a stable,
 * human-legible id derived from the same content the record is matched by (not from location), so
 * two records with identical `mutator`/`original`/`replacement` in the same file would collide
 * (and are, deliberately, covered by a single record -- see this module's own doc comment).
 */
function deriveMutationId(
  mutant: Pick<ResolvedMutant, "file" | "mutator" | "original" | "replacement">,
): string {
  const digest = hashRequirementFields(mutant, ["original", "replacement"], (m, field) =>
    fieldValue(m as unknown as MutationExceptionRecord, field),
  )
  return `mutation:${mutant.file}:${mutant.mutator}:${digest.slice(0, 12)}`
}

const MUTATION_EXCEPTION_SCHEMA: ExceptionRegistrySchema<MutationExceptionRecord> = {
  namespace: "mutation:",
  metadataKeys: ["file", "mutator", "original", "replacement"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const { file, mutator, original, replacement } = raw

    const fileValid = typeof file === "string" && file.length > 0
    if (!fileValid) errors.push(`${at}.file must be a non-empty string.`)
    const mutatorValid = typeof mutator === "string" && mutator.length > 0
    if (!mutatorValid) errors.push(`${at}.mutator must be a non-empty string.`)
    const originalValid = typeof original === "string" && original.length > 0
    if (!originalValid) errors.push(`${at}.original must be a non-empty string.`)
    const replacementValid = typeof replacement === "string"
    if (!replacementValid) errors.push(`${at}.replacement must be a string.`)
    if (!fileValid || !mutatorValid || !originalValid || !replacementValid) return undefined

    const identity = { file, mutator, original, replacement }
    const derived = deriveMutationId(identity)
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own file/mutator/original/replacement (${JSON.stringify(derived)}).`,
      )
      return undefined
    }

    return { id: core.id, version: 1, justification: core.justification, ...identity }
  },
}

/** Every mutation exception is `{ mode: "exception", requirements: ["justification"] }` -- there is no severity tier here, unlike security findings. */
const EXCEPTION_POLICY_CONFIG: ExceptionPolicyConfig = {
  mutation: { default: { mode: "exception", requirements: ["justification"] } },
}
const GLOBAL_DEFAULT: ExceptionPolicy = { mode: "exception", requirements: ["justification"] }
const CLASSIFICATION = [{ group: "mutation", category: "waived" }] as const

const SURVIVED_LIKE = new Set(["Survived", "NoCoverage"])

/** Reads and parses Stryker's own JSON report, or the fail result to return verbatim when it produced none. */
async function readMutationReport(
  result: CheckEvidence,
): Promise<
  | { readonly ok: true; readonly report: MutationReport }
  | { readonly ok: false; readonly result: PolicyResult }
> {
  try {
    const raw = await readFile(path.join(process.cwd(), "reports/mutation/mutation.json"), "utf8")
    return { ok: true, report: JSON.parse(raw) as MutationReport }
  } catch {
    const tail = combinedOutput(result).slice(-3000)
    return {
      ok: false,
      result: {
        outcome: "fail",
        rationale: `Mutation: Stryker did not produce reports/mutation/mutation.json.${tail ? `\n${tail}` : ""}`,
      },
    }
  }
}

/** One registry record's outcome against the current report: which mutants it suppresses, or why it doesn't apply. */
interface RecordOutcome {
  readonly stale?: string
  readonly insufficient?: string
  readonly suppressed: readonly ResolvedMutant[]
}

/**
 * Resolves a single exception record against this run's mutants -- stale (matches nothing at all),
 * insufficient/forbidden per policy, or the `SURVIVED_LIKE` mutants it suppresses. See this module's
 * own doc comment for why staleness is "matches nothing," never "isn't currently Survived."
 */
function resolveRecordOutcome(
  record: MutationExceptionRecord,
  mutants: readonly ResolvedMutant[],
): RecordOutcome {
  const matches = mutants.filter((m) => matchesRecord(m, record))
  if (matches.length === 0) {
    return {
      stale: `${record.id} -- ${record.file} [${record.mutator}] "${record.original}" -> "${record.replacement}" no longer matches any mutant in the report; the surrounding code likely changed.`,
      suppressed: [],
    }
  }

  const determinant = evaluateExceptionRecord({
    record,
    classifications: CLASSIFICATION,
    config: EXCEPTION_POLICY_CONFIG,
    globalDefault: GLOBAL_DEFAULT,
    fieldValue,
  })
  if (determinant.verdict === "insufficient") {
    return {
      insufficient: `${record.id} -- missing: ${determinant.missing.join(", ")}. Fill those fields in ${REGISTRY_RELATIVE_PATH}.`,
      suppressed: [],
    }
  }
  if (determinant.verdict === "forbidden") {
    return {
      insufficient: `${record.id} -- policy forbids waiving this mutant.`,
      suppressed: [],
    }
  }

  return { suppressed: matches.filter((m) => SURVIVED_LIKE.has(m.status)) }
}

/** Applies every registry record to this run's mutants, aggregating staleness/policy problems and the resulting suppression set. */
function applyExceptionRegistry(
  mutants: readonly ResolvedMutant[],
  records: readonly MutationExceptionRecord[],
): {
  readonly stale: readonly string[]
  readonly insufficient: readonly string[]
  readonly suppressed: ReadonlySet<ResolvedMutant>
} {
  const stale: string[] = []
  const insufficient: string[] = []
  const suppressed = new Set<ResolvedMutant>()
  for (const record of records) {
    const outcome = resolveRecordOutcome(record, mutants)
    if (outcome.stale !== undefined) stale.push(outcome.stale)
    if (outcome.insufficient !== undefined) insufficient.push(outcome.insufficient)
    for (const m of outcome.suppressed) suppressed.add(m)
  }
  return { stale, insufficient, suppressed }
}

/** The final score/verdict once every valid mutant has been counted, suppressions applied. */
function summarizeMutationScore(
  mutants: readonly ResolvedMutant[],
  suppressed: ReadonlySet<ResolvedMutant>,
): PolicyResult {
  const counts: Record<string, number> = {}
  for (const mutant of mutants) {
    if (suppressed.has(mutant)) continue
    counts[mutant.status] = (counts[mutant.status] ?? 0) + 1
  }

  const killed = counts["Killed"] ?? 0
  const timeout = counts["Timeout"] ?? 0
  const survived = counts["Survived"] ?? 0
  const noCoverage = counts["NoCoverage"] ?? 0
  const detected = killed + timeout
  const valid = detected + survived + noCoverage

  // Reachable only when every single mutant in the report was excluded by a
  // registry record (`mutants.length > 0` was already confirmed by the
  // caller) -- a genuinely empty Stryker report is caught there instead.
  // `detected / 0` would be `NaN`; there is nothing left to score, and that
  // is success, not the "Stryker never even ran" failure above.
  if (valid === 0) {
    return {
      outcome: "pass",
      rationale: `Mutation: every mutant in the report (${String(mutants.length)}) was excluded by a known Stryker false positive, see ${REGISTRY_RELATIVE_PATH}.`,
    }
  }

  const score = (detected / valid) * 100
  const suppressedNote =
    suppressed.size > 0
      ? ` (${String(suppressed.size)} known Stryker false positive${suppressed.size === 1 ? "" : "s"} excluded, see ${REGISTRY_RELATIVE_PATH})`
      : ""
  const summary = `score ${score.toFixed(2)}% (killed ${String(killed)}, timeout ${String(timeout)}, survived ${String(survived)}, no-coverage ${String(noCoverage)})${suppressedNote}`

  return score < MUTATION_THRESHOLD
    ? {
        outcome: "fail",
        rationale: `Mutation: ${summary} < ${String(MUTATION_THRESHOLD)}% required.`,
      }
    : { outcome: "pass", rationale: `Mutation: ${summary} >= ${String(MUTATION_THRESHOLD)}%.` }
}

/** @returns the `Mutation` check. */
export function mutation(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath, "--fallback-config", bundledConfig("stryker.config.mjs")],
    policy: async ({ result }): Promise<PolicyResult> => {
      const terminated = abnormalTermination(result, "Stryker")
      if (terminated) return { outcome: "fail", rationale: terminated }

      const reportResult = await readMutationReport(result)
      if (!reportResult.ok) return reportResult.result

      const registryPath = path.join(process.cwd(), REGISTRY_RELATIVE_PATH)
      const loaded = await loadExceptionRegistry({
        path: registryPath,
        schema: {
          "~standard": {
            version: 1,
            vendor: "internal-package-contract",
            validate: (value: unknown) => {
              const validated = validateExceptionRegistry(value, MUTATION_EXCEPTION_SCHEMA)
              return validated.ok
                ? { value: validated.records }
                : { issues: validated.errors.map((message) => ({ message })) }
            },
          },
        },
      })
      if (!loaded.ok) {
        return {
          outcome: "fail",
          rationale: [
            `Mutation: ${REGISTRY_RELATIVE_PATH} failed to load:`,
            ...loaded.errors.map((e) => `- ${e}`),
          ].join("\n"),
        }
      }

      const mutants = resolveMutants(reportResult.report)
      if (mutants.length === 0) {
        return { outcome: "fail", rationale: "Mutation: Stryker report contains 0 valid mutants." }
      }

      // A record is stale -- and must be removed -- only when it matches
      // NOTHING in the current report, meaning the surrounding code actually
      // changed. It is deliberately NOT stale just because it currently
      // matches only Killed/Timeout mutants -- see this module's own doc
      // comment for why (Stryker's own non-determinism, not this check's).
      const { stale, insufficient, suppressed } = applyExceptionRegistry(mutants, loaded.records)
      if (stale.length > 0 || insufficient.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            `Mutation: ${REGISTRY_RELATIVE_PATH} has ${String(stale.length + insufficient.length)} problem(s):`,
            ...insufficient.map((s) => `- ${s}`),
            ...stale.map((s) => `- ${s}`),
          ].join("\n"),
        }
      }

      return summarizeMutationScore(mutants, suppressed)
    },
  }
}
