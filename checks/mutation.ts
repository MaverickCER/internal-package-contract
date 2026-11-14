/**
 * `Mutation`: every Stryker mutant is detected, or a hand-verified record in
 * `.repo-contract/exceptions/mutation.json` covers it. None times out.
 *
 * Reads: the package's own `stryker.config.*` when one exists, else the bundled
 * `config/stryker.config.mjs` (Vitest runner, `mutate: src/**`). Also the scope document of the
 * run, and `IPC_MUTATION_REPORT`, `IPC_MUTATION_SHARD` and `IPC_MUTATION_MEMO`. Then
 * `reports/mutation/mutation.json`, which `scripts/run-mutation.mjs` leaves after running Stryker
 * with every mutant forced. Then `.repo-contract/exceptions/mutation.json`.
 *
 * Fails on any `Survived`, `NoCoverage` or `Timeout` mutant no record covers. Each is listed with
 * file, line, mutator and a before/after snippet; the list is capped. A `Timeout` is never counted
 * as detected: a mutant that removes a loop bound can only hang. `Killed`, `RuntimeError` and
 * `CompileError` count as detected. The score is reported but never gates. Fails when Stryker wrote
 * no report, or one with no mutants. Fails when the registry cannot be loaded, or a record is
 * incomplete. On a full run only, fails when a record matches nothing in the report (stale). With
 * `IPC_MUTATION_REPORT` set, that report is judged instead of mutating; it fails when the change
 * affects no source. Never warns.
 *
 * Exceptions: id `mutation:<file>:<mutator>:<hash of original and replacement>`, with `file`,
 * `mutator`, `original` and `replacement` fields and the version 2 fields. A record matches by
 * source text, never by line, so it goes stale the moment the code around it changes. It can cover
 * `Survived` and `NoCoverage` only, never `Timeout`. No stub is ever written. A record exists
 * because a person applied the mutation by hand and saw the suite fail. Stryker's per-test coverage
 * can still misreport that mutant as surviving.
 *
 * Runs in the consumer `contract` job and in IPC's own self-contract. The pre-commit hook runs it
 * under `--scope affected`. There it mutates only the changed non-test modules the affected
 * analysis accepts, inside `src/` or not. It passes without running when there are none. The
 * pre-push hook skips it by name. It is `isolated` and declared last: Stryker brings its own worker
 * pool.
 *
 * Limits: Stryker's per-test verdicts are not deterministic, so the same mutant can flip between
 * runs. A narrowed or sharded run cannot say a record is stale. A mutant that flickers to `Timeout`
 * needs a source fix, not a record: a `// Stryker disable` with its reason, or a fail-fast guard.
 *
 * Example record:
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "mutation:src/build/resolution/resolve-package-schema.ts:ConditionalExpression:2f8a1c9e4b7d",
 *       "version": 2,
 *       "justification": "Hand-applying this exact mutation fails the \"memoizes\" test; Stryker's per-test coverage still reports it Survived.",
 *       "file": "src/build/resolution/resolve-package-schema.ts",
 *       "mutator": "ConditionalExpression",
 *       "original": "!cached",
 *       "replacement": "true",
 *       "ruleBroken": "Every mutant is detected by the suite.",
 *       "attempted": "A second test for the memoization; Stryker reported the same mutant surviving.",
 *       "constraint": "Stryker's per-test coverage attribution misses the test that kills it.",
 *       "whyPreferable": "The test exists and fails under the mutation; the record names it.",
 *       "residualRisk": "None: the behaviour is covered, only the report is wrong.",
 *       "revisitWhen": "Stryker is upgraded, or the guarded line changes.",
 *       "expires": ""
 *     }
 *   ]
 * }
 * ```
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
import {
  EXCEPTION_V2_FIELD_KEYS,
  isValidNonEmptyStringField,
  recordFieldValue,
  validateExceptionRegistry,
} from "./exception-record.js"
import type { ExceptionRegistrySchema, ExceptionV2Fields } from "./exception-record.js"
import { reportToAdopt } from "../scripts/mutation/adopt.mjs"
import { shardSpecOf } from "../scripts/mutation/shard.mjs"
import { narrowedScope } from "./scope.js"
import { abnormalTermination, bundledConfig, combinedOutput, packageRoot } from "./shared.js"

/** Where a consumer's mutation exception registry lives: the standard `.repo-contract/exceptions/*.json` location every repo-contract v0.4.0+ registry shares. */
const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/mutation.json"

const scriptPath = path.join(packageRoot, "scripts", "run-mutation.mjs")

/** @internal Exported for {@link extractSpan}'s own direct-test parameter type. */
export interface MutantLocation {
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
/** @internal Exported for {@link resolveMutants}'s own direct-test fixtures. */
export interface MutationReport {
  readonly files?: Record<string, MutationReportFile>
}

/** One `.repo-contract/exceptions/mutation.json` record: the shared core plus this registry's own identity fields. @internal Exported for {@link fieldValue}'s own direct-test fixtures. */
export interface MutationExceptionRecord extends Partial<ExceptionV2Fields> {
  readonly id: string
  readonly version: 1 | 2
  readonly justification: string
  readonly file: string
  readonly mutator: string
  readonly original: string
  readonly replacement: string
}

/**
 * The exact source span Stryker's `location` refers to, read back from the `source` the report
 * carries for that file. Lines and columns are 1-indexed and the end column is exclusive, as in
 * Stryker's own diffs. Empty when the location is missing or out of range; no real registry
 * record matches an empty span.
 */
/**
 * @internal Exported for direct unit tests. Its edge cases are out-of-range lines at either end of a
 * span, and single- against multi-line spans. Otherwise only a full mutation-report fixture reaches them.
 */
export function extractSpan(
  source: string | undefined,
  location: MutantLocation | undefined,
): string {
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

/** One resolved mutant: its report status and the identity fields a {@link MutationExceptionRecord} matches. */
export interface ResolvedMutant {
  readonly file: string
  readonly status: string
  readonly mutator: string
  readonly original: string
  readonly replacement: string
  /**
   * 1-indexed source line the mutant starts on, `0` when the report has no location. A failing
   * rationale names it, so a reader goes straight to the mutant without opening the JSON report.
   */
  readonly line: number
}

/**
 * @internal Exported for direct unit tests of its `mutatorName` and `replacement` `?? ""` fallbacks.
 * A real Stryker report always sets both, though its schema marks them optional, so no full fixture
 * reaches them.
 */
export function resolveMutants(report: MutationReport): readonly ResolvedMutant[] {
  const resolved: ResolvedMutant[] = []
  for (const [file, fileResult] of Object.entries(report.files ?? {})) {
    for (const mutant of fileResult.mutants ?? []) {
      resolved.push({
        file,
        status: mutant.status,
        mutator: mutant.mutatorName ?? "",
        original: extractSpan(fileResult.source, mutant.location),
        replacement: mutant.replacement ?? "",
        line: mutant.location?.start.line ?? 0,
      })
    }
  }
  return resolved
}

/** Whether a registry record describes exactly this mutant: same file, mutator, original source text and replacement. */
function matchesRecord(mutant: ResolvedMutant, record: MutationExceptionRecord): boolean {
  return (
    mutant.file === record.file &&
    mutant.mutator === record.mutator &&
    mutant.original === record.original &&
    mutant.replacement === record.replacement
  )
}

/**
 * @internal Exported for direct unit tests of its `: ""` fallback: a requirement that names a
 * non-string field, such as `version`, or a missing key. The real callers only ask for `file`,
 * `mutator`, `original` and `replacement`, so they never reach it.
 */
export function fieldValue(record: MutationExceptionRecord, requirement: string): string {
  return recordFieldValue(record, requirement)
}

/**
 * `mutation:<file>:<mutator>:<12-hex-char digest of original+replacement>`: a stable,
 * human-legible id derived from the same content the record is matched by, not from location. Two
 * mutants with identical `mutator`/`original`/`replacement` in the same file therefore collide and
 * are, deliberately, covered by a single record (see this module's own doc comment).
 */
function deriveMutationId(
  mutant: Pick<ResolvedMutant, "file" | "mutator" | "original" | "replacement">,
): string {
  const digest = hashRequirementFields(mutant, ["original", "replacement"], (m, field) =>
    fieldValue(m as unknown as MutationExceptionRecord, field),
  )
  return `mutation:${mutant.file}:${mutant.mutator}:${digest.slice(0, 12)}`
}

/** @internal Exported for direct unit coverage. */
export const MUTATION_EXCEPTION_SCHEMA: ExceptionRegistrySchema<MutationExceptionRecord> = {
  namespace: "mutation:",
  metadataKeys: ["file", "mutator", "original", "replacement"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const { file, mutator, original, replacement } = raw

    const fileValid = isValidNonEmptyStringField(file, `${at}.file`, errors)
    const mutatorValid = isValidNonEmptyStringField(mutator, `${at}.mutator`, errors)
    const originalValid = isValidNonEmptyStringField(original, `${at}.original`, errors)
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

/** No per-group tiering: there is no severity here, unlike security findings, so every mutation exception falls through to {@link GLOBAL_DEFAULT}. */
const EXCEPTION_POLICY_CONFIG: ExceptionPolicyConfig = {}
/** Every mutation exception is `{ mode: "exception", requirements: ["justification", ...EXCEPTION_V2_FIELD_KEYS] }`. */
const GLOBAL_DEFAULT: ExceptionPolicy = {
  mode: "exception",
  requirements: ["justification", ...EXCEPTION_V2_FIELD_KEYS],
}
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
    // Stryker disable next-line StringLiteral: an equivalent mutant -- `readFile(path, "")` yields a
    // Buffer, which `JSON.parse` coerces to byte-for-byte the same text `"utf8"` would have decoded.
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
 * Resolves a single exception record against this run's mutants: stale (matches nothing at all),
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
      stale: `${record.id}: ${record.file} [${record.mutator}] "${record.original}" -> "${record.replacement}" no longer matches any mutant in the report; the surrounding code likely changed.`,
      // An equivalent mutant. `applyExceptionRegistry` still adds Stryker's placeholder to the
      // suppression set. But `summarizeMutationScore`'s `suppressed.has(mutant)` never matches a
      // real `ResolvedMutant` against it, so no real report can observe it. Hand-verified.
      // Stryker disable next-line ArrayDeclaration
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
      insufficient: `${record.id} is missing ${determinant.missing.join(", ")}. Fill those fields in ${REGISTRY_RELATIVE_PATH}.`,
      // Same genuinely equivalent mutant as the stale branch above:
      // hand-verified.
      // Stryker disable next-line ArrayDeclaration
      suppressed: [],
    }
  }
  // Unreachable today: this file's policy is always `mode: "exception"`, so
  // `evaluateExceptionRecord` never says "forbidden" for a mutation record.
  // The verdict exists for other record types, such as CodeRabbit's
  // `mechanical-reverification`. If this policy ever gains a forbidden tier,
  // this branch fails closed.
  // Stryker disable BlockStatement, ObjectLiteral, ConditionalExpression, StringLiteral, ArrayDeclaration
  if (determinant.verdict === "forbidden") {
    return {
      insufficient: `${record.id}: policy forbids waiving this mutant.`,
      suppressed: [],
    }
  }
  // Stryker restore BlockStatement, ObjectLiteral, ConditionalExpression, StringLiteral, ArrayDeclaration

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

/**
 * How many offending mutants a failing rationale lists one by one. A regression of hundreds of
 * mutants would otherwise flood the output and the CI step-summary limit all checks share. Past
 * two dozen, more lines add nothing.
 */
const MAX_LISTED_OFFENDERS = 25
/**
 * Each offender's `original` and `replacement` snippet is collapsed to one line and capped. A
 * multi-line span, common for `BlockStatement` and `ArrowFunction` mutants, would make the listing unreadable.
 */
const MAX_SNIPPET_LENGTH = 80

/** @internal Exported for direct unit coverage. */
export function truncateSnippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  return collapsed.length > MAX_SNIPPET_LENGTH
    ? `${collapsed.slice(0, MAX_SNIPPET_LENGTH)}…`
    : collapsed
}

/**
 * Lists the Survived, NoCoverage and Timeout mutants no record covers, each with file, line,
 * mutator and a short before/after snippet. A failing rationale then says which mutant and where,
 * not only how many. A reader can hand-verify that exact mutant next, as the module comment
 * describes.
 * @internal Exported for direct unit coverage.
 */
export function formatOffendingMutants(offenders: readonly ResolvedMutant[]): string {
  const lines = offenders
    .slice(0, MAX_LISTED_OFFENDERS)
    .map(
      (m) =>
        `- ${m.file}:${String(m.line)} [${m.status} ${m.mutator}] "${truncateSnippet(m.original)}" -> "${truncateSnippet(m.replacement)}"`,
    )
  if (offenders.length > MAX_LISTED_OFFENDERS) {
    lines.push(`... and ${String(offenders.length - MAX_LISTED_OFFENDERS)} more.`)
  }
  return lines.join("\n")
}

/** How many files to name when listing where `Ignored` mutants are. */
const MAX_IGNORED_FILES = 5

/**
 * The evidence for mutants Stryker did not test because a `// Stryker disable` comment (or
 * `ignoreStatic`) told it not to. They count neither for nor against the score. Without this note a
 * file could exclude most of itself from mutation testing behind a clean score.
 * @param mutants - Every mutant in the report.
 * @returns A leading-space note naming the count and the files holding most of them, or `""` for none.
 * @internal Exported for direct unit coverage.
 */
export function describeIgnored(mutants: readonly ResolvedMutant[]): string {
  const byFile = new Map<string, number>()
  for (const mutant of mutants) {
    if (mutant.status === "Ignored") byFile.set(mutant.file, (byFile.get(mutant.file) ?? 0) + 1)
  }
  if (byFile.size === 0) return ""
  const total = [...byFile.values()].reduce((sum, n) => sum + n, 0)
  const top = [...byFile.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_IGNORED_FILES)
    .map(([file, n]) => `${file} ${String(n)}`)
  const more =
    byFile.size > MAX_IGNORED_FILES
      ? `, +${String(byFile.size - MAX_IGNORED_FILES)} more file(s)`
      : ""
  return `; ${String(total)} ignored by Stryker disable comments or ignoreStatic (${top.join(", ")}${more})`
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
  const ignoredNote = describeIgnored(mutants)
  const runtimeErrors = counts["RuntimeError"] ?? 0
  const compileErrors = counts["CompileError"] ?? 0
  // Timeout is deliberately excluded here, the same tier as Survived, never
  // counted as detected: see this module's own doc comment. A genuine
  // crash (RuntimeError/CompileError) is still a real, observed failure
  // signal, so it counts the same as an assertion-based kill.
  const detected = killed + runtimeErrors + compileErrors
  const valid = detected + survived + noCoverage + timeout

  // Reachable only when a registry record excluded every mutant in the report. The caller already
  // confirmed `mutants.length > 0`, so it catches an empty Stryker report instead.
  // `detected / 0` would be `NaN`; there is nothing left to score, and that
  // is success, not the "Stryker never even ran" failure above.
  if (valid === 0) {
    return {
      outcome: "pass",
      rationale: `Mutation: every mutant in the report (${String(mutants.length)}) was excluded by a known Stryker false positive, see ${REGISTRY_RELATIVE_PATH}${ignoredNote}.`,
    }
  }

  const score = (detected / valid) * 100
  const suppressedNote =
    suppressed.size > 0
      ? ` (${String(suppressed.size)} known Stryker false positive${suppressed.size === 1 ? "" : "s"} excluded, see ${REGISTRY_RELATIVE_PATH})`
      : ""
  const summary = `score ${score.toFixed(2)}% (killed ${String(killed)}, timeout ${String(timeout)}, survived ${String(survived)}, no-coverage ${String(noCoverage)})${suppressedNote}${ignoredNote}`

  // Zero-tolerance: survived/noCoverage/timeout must all be exactly zero,
  // not merely small relative to the total; matching repo-contract's own
  // real policy, not a score threshold.
  const passed = survived === 0 && noCoverage === 0 && timeout === 0
  if (passed) return { outcome: "pass", rationale: `Mutation: ${summary}.` }

  const offenders = mutants.filter(
    (m) =>
      !suppressed.has(m) &&
      (m.status === "Survived" || m.status === "NoCoverage" || m.status === "Timeout"),
  )
  return {
    outcome: "fail",
    rationale: [
      `Mutation: ${summary}; ${String(survived)} survived, ${String(noCoverage)} no-coverage, ${String(timeout)} timeout must all be zero.`,
      formatOffendingMutants(offenders),
    ].join("\n"),
  }
}

/** @returns the `Mutation` check. */
export function mutation(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath, "--fallback-config", bundledConfig("stryker.config.mjs")],
    policy: async (ctx): Promise<PolicyResult> => {
      const { result } = ctx
      // A narrowed run mutates only the sources a change affects; with none, there is nothing to judge.
      const narrowed = narrowedScope(ctx)
      if (narrowed?.mutate.length === 0) {
        // A supplied report has nothing to be judged against here, and must not pass as if it had.
        if (reportToAdopt(process.env, process.cwd()) !== undefined) {
          return {
            outcome: "fail",
            rationale:
              "Mutation: IPC_MUTATION_REPORT names a report, but no source file is affected by this change, so there is nothing to judge it against.",
          }
        }
        return {
          outcome: "pass",
          rationale: "Mutation: no source file is affected by this change, so nothing was mutated.",
        }
      }
      const shard = shardSpecOf(process.env)
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
            // repo-contract's `loadExceptionRegistry` only checks that
            // `vendor` is a string. The name is descriptive and never
            // compared, so a change to its content is unobservable.
            // Hand-verified.
            // Stryker disable next-line StringLiteral
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

      // A record is stale, and must go, only when it matches nothing in the report: its code changed.
      // A record that matches only Killed or Timeout mutants stays: Stryker can report the same
      // mutant differently between runs, as the module comment explains.
      const {
        stale: unmatched,
        insufficient,
        suppressed,
      } = applyExceptionRegistry(mutants, loaded.records)
      // A narrowed run, or one shard, mutates part of the package. A record for a mutant elsewhere
      // matches nothing there without being stale. Only a full run can call a record stale.
      const stale = narrowed === undefined && shard === undefined ? unmatched : []
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

      const judged = summarizeMutationScore(mutants, suppressed)
      return shard === undefined
        ? judged
        : {
            ...judged,
            rationale: `Mutation (shard ${shard}):${judged.rationale.slice("Mutation:".length)}`,
          }
    },
  }
}
