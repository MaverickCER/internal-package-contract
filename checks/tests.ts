/**
 * The consumer's whole Vitest suite, run once WITH V8 coverage instrumentation.
 *
 * repo-contract splits this into `test-unit`/`test-integration`/`test-property`/
 * `test-e2e`; here one `Tests` check runs everything. It is the single
 * heaviest check, so it also produces the coverage artifacts the `Coverage` and
 * `Crap` checks then read (they `dependsOn` it) -- one Vitest run, not three.
 *
 * The Vitest JSON report goes to a file (`--outputFile`) so stdout stays free
 * for the coverage reporter; the policy reads the file and delegates the verdict
 * to repo-contract's own `test` preset policy.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type { ExceptionRecordCore, StandardSchemaV1 } from "repo-contract/helpers"
import { loadExceptionRegistry } from "repo-contract/helpers"
import { test as testPreset } from "repo-contract/presets"
import { incompleteFields } from "./environment-exceptions.js"
import { isValidNonEmptyStringField, validateExceptionRegistry } from "./exception-record.js"
import type { ExceptionRegistrySchema, ExceptionV2Fields } from "./exception-record.js"
import { abnormalTermination, combinedOutput } from "./shared.js"

const SKIPPED_REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/skipped-tests.json"
const MAX_LISTED = 20

/** One `.repo-contract/exceptions/skipped-tests.json` record: why the skipped tests of one file are skipped. */
export interface SkippedTestsRecord extends Partial<ExceptionV2Fields> {
  readonly id: string
  readonly version: 1 | 2
  readonly justification: string
  readonly file: string
}

/**
 * `skipped-test:<file>` -- one record covers every skipped or todo test in a file, because a file
 * usually skips as a unit (`describe.skipIf(!installed)`), for one reason.
 * @param file - repo-relative, forward-slash test file path.
 * @returns the record id.
 * @internal Exported for direct unit coverage.
 */
export function deriveSkippedTestsId(file: string): string {
  return `skipped-test:${file}`
}

/** @internal Exported for direct unit coverage. */
export const SKIPPED_TESTS_SCHEMA: ExceptionRegistrySchema<SkippedTestsRecord> = {
  namespace: "skipped-test:",
  metadataKeys: ["file"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const { file } = raw
    if (!isValidNonEmptyStringField(file, `${at}.file`, errors)) return undefined
    const derived = deriveSkippedTestsId(file)
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own file (${JSON.stringify(derived)}).`,
      )
      return undefined
    }
    return { id: core.id, version: 1, justification: core.justification, file }
  },
}

const skippedRegistrySchema: StandardSchemaV1<unknown, readonly SkippedTestsRecord[]> = {
  "~standard": {
    version: 1,
    vendor: "internal-package-contract",
    validate: (value: unknown) => {
      const result = validateExceptionRegistry(value, SKIPPED_TESTS_SCHEMA)
      return result.ok
        ? { value: result.records }
        : { issues: result.errors.map((message) => ({ message })) }
    },
  },
}

interface VitestReport {
  readonly numTotalTests?: number
  readonly numPassedTests?: number
  readonly numPendingTests?: number
  readonly numTodoTests?: number
  readonly testResults?: readonly {
    readonly name?: string
    readonly assertionResults?: readonly { readonly status?: string }[]
  }[]
}

/**
 * The skipped (`pending`) and `todo` tests of each file.
 * @param report - Vitest's JSON report.
 * @param root - the repository root, which file names are made relative to.
 * @returns `file -> { skipped, todo }` for every file with at least one.
 * @internal Exported for direct unit coverage.
 */
export function skippedByFile(
  report: VitestReport,
  root: string,
): ReadonlyMap<string, { skipped: number; todo: number }> {
  const byFile = new Map<string, { skipped: number; todo: number }>()
  for (const result of report.testResults ?? []) {
    const file = path
      .relative(root, result.name ?? "")
      .split(path.sep)
      .join("/")
    for (const assertion of result.assertionResults ?? []) {
      if (
        assertion.status !== "pending" &&
        assertion.status !== "skipped" &&
        assertion.status !== "todo"
      )
        continue
      const counts = byFile.get(file) ?? { skipped: 0, todo: 0 }
      if (assertion.status === "todo") counts.todo += 1
      else counts.skipped += 1
      byFile.set(file, counts)
    }
  }
  return byFile
}

/**
 * A run of "N tests, 0 failures" says nothing about the tests that did not run. This holds the
 * skips to the same standard as every other exception: a test file that skips needs a complete
 * `skipped-test:<file>` record saying why (a platform-only suite, a fixture installed by a separate
 * CI job), and a run in which no test ran at all fails.
 * @param report - Vitest's JSON report.
 * @param passRationale - the delegated pass verdict's rationale.
 * @returns the verdict for the run's skips.
 */
async function judgeSkips(report: VitestReport, passRationale: string): Promise<PolicyResult> {
  const total = report.numTotalTests ?? 0
  if (total === 0) {
    return {
      outcome: "fail",
      rationale: "Tests: Vitest ran 0 tests -- a suite that runs nothing proves nothing.",
    }
  }
  const skips = skippedByFile(report, process.cwd())
  if (skips.size === 0) return { outcome: "pass", rationale: passRationale }

  const loaded = await loadExceptionRegistry({
    path: path.join(process.cwd(), SKIPPED_REGISTRY_RELATIVE_PATH),
    schema: skippedRegistrySchema,
  })
  if (!loaded.ok) {
    return {
      outcome: "fail",
      rationale: [
        `Tests: ${SKIPPED_REGISTRY_RELATIVE_PATH} failed to load:`,
        ...loaded.errors.map((error) => `- ${error}`),
      ].join("\n"),
    }
  }
  const records = new Map(loaded.records.map((record) => [record.id, record]))
  const now = new Date()
  const unexplained: string[] = []
  for (const [file, counts] of skips) {
    const id = deriveSkippedTestsId(file)
    const record = records.get(id)
    const what = `${String(counts.skipped)} skipped${counts.todo > 0 ? `, ${String(counts.todo)} todo` : ""}`
    if (record === undefined) {
      unexplained.push(`- ${file}: ${what} -- add ${id} to ${SKIPPED_REGISTRY_RELATIVE_PATH}`)
      continue
    }
    const missing = incompleteFields(record, now)
    if (missing.length > 0) {
      unexplained.push(`- ${file}: ${what} -- ${id} is incomplete (missing: ${missing.join(", ")})`)
    }
  }
  const totalSkipped = [...skips.values()].reduce((sum, c) => sum + c.skipped + c.todo, 0)
  if (unexplained.length > 0) {
    return {
      outcome: "fail",
      rationale: [
        `Tests: ${String(totalSkipped)} test(s) did not run in ${String(skips.size)} file(s), and ${String(unexplained.length)} file(s) have no complete record of why:`,
        ...unexplained.slice(0, MAX_LISTED),
        ...(unexplained.length > MAX_LISTED
          ? [`...and ${String(unexplained.length - MAX_LISTED)} more.`]
          : []),
      ].join("\n"),
    }
  }
  return {
    outcome: "pass",
    rationale: `${passRationale} ${String(totalSkipped)} test(s) skipped in ${String(skips.size)} file(s), each explained by a record in ${SKIPPED_REGISTRY_RELATIVE_PATH}.`,
  }
}

/**
 * Where the Vitest JSON reporter writes. This is deliberately the exact path repo-contract's own
 * `test` preset reads (newer repo-contract versions read this file themselves instead of the
 * process's stdout), so the delegation below works against both the older stdout-based preset and
 * the newer file-based one.
 */
export const VITEST_RESULTS_PATH = "reports/vitest/vitest-report.json"

/** @returns the `Tests` check. */
export function tests(): CheckDefinitionConfig {
  return {
    run: [
      "vitest",
      "run",
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reporter=json-summary",
      "--coverage.reporter=json",
      "--coverage.reportsDirectory=coverage",
      "--reporter=json",
      `--outputFile=${VITEST_RESULTS_PATH}`,
    ],
    policy: async (ctx): Promise<PolicyResult> => {
      const terminated = abnormalTermination(ctx.result, "Vitest")
      if (terminated) return { outcome: "fail", rationale: terminated }

      let report: VitestReport
      try {
        // Stryker disable next-line StringLiteral: an equivalent mutant -- `readFile(path, "")`
        // returns a Buffer instead of a string, but `JSON.parse` coerces any non-string argument
        // via its default (utf8) `toString()`, which produces byte-for-byte the same text `"utf8"`
        // would have decoded. Hand-verified: forcing this to `""` leaves every test in
        // tests-check.test.ts passing unchanged.
        report = JSON.parse(
          await readFile(path.join(process.cwd(), VITEST_RESULTS_PATH), "utf8"),
        ) as VitestReport
      } catch {
        const tail = combinedOutput(ctx.result).slice(-3000)
        return {
          outcome: "fail",
          rationale: `Tests: Vitest did not produce ${VITEST_RESULTS_PATH}.${tail ? `\n${tail}` : ""}`,
        }
      }
      // repo-contract's own `test` preset reads that same file itself, and decides pass or fail.
      const verdict = await testPreset.policy(ctx)
      if (verdict.outcome !== "pass") return verdict
      // ...but "0 failures" says nothing about tests that did not run.
      return judgeSkips(report, verdict.rationale)
    },
  }
}
