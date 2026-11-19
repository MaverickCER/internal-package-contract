// The durable record of a contract run, shared by `bin/contract.mjs` and `scripts/run-contract.mjs`.
//
// A run produces repo-contract's `Evidence` (what each check executed) and `Verdict` (what the policy
// concluded). Printing them and throwing them away leaves nothing a reviewer, a dashboard or a later run can
// read, so this module writes:
//
//   reports/contract/evidence.json   the evidence of every phase, merged into one version-1 document
//   reports/contract/report.json     the verdict plus per-check class, timing and run totals
//   reports/contract/summary.md      the same as Markdown; contract-run.mjs appends it to $GITHUB_STEP_SUMMARY,
//                                    cut under GitHub's 1 MiB limit (see `stepSummary`)
//
// The report also says what the contract loosened against the standard (`checks/baseline.ts`), with
// repo-contract's `explainTier` and `renderExplain`.
//
// `warn` is overloaded: "a real but non-blocking finding" and "this could not be evaluated here" read the same.
// Each result is therefore also given a class (see `classifyResult`), read from how its rationale starts. A run
// that is yellow only because of unexplained "not evaluated" results is not the same as a green one; under
// `--strict` it fails. A failing check a package has not promoted (adoption mode) is counted but does not fail
// the run.

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { renderExplain } from "repo-contract/tiers"

/** Starts a rationale whose check could not run here and that an exception record has accepted. */
export const NOT_EVALUATED_ACCEPTED = "Not evaluated (accepted by"
/** Starts a rationale whose check could not run here and that no exception record covers. */
export const NOT_EVALUATED_UNEXCEPTED = "Not evaluated (no exception recorded"

/**
 * Follows the "Compared with the standard" section, which compares settings and check ids only. A reader
 * would otherwise take the verdicts of these replaced checks for repo-contract's.
 */
export const OWN_CHECKS_NOTE =
  "IPC runs its own version of seven tier checks: `Tests`, `SecuritySecrets`, `SecurityDeps`, `DeadCode`, `DocsLinks`, `DistNoUrls` and `Commits`. Their verdicts are not repo-contract's. `checks/standard.ts` says how each one differs."

/**
 * @typedef {"pass" | "warn" | "not-evaluated" | "unexcepted" | "fail" | "skipped"} ResultClass
 * @typedef {{ outcome: string, rationale: string }} PolicyResultLike
 */

/**
 * The class of one check's result.
 * - `pass` / `fail`: as the policy said.
 * - `warn`: a real finding that does not block.
 * - `not-evaluated`: the check could not run here, and a recorded exception accepts that.
 * - `unexcepted`: the check could not run here and nothing records why that is acceptable.
 * @param {PolicyResultLike} result
 * @returns {ResultClass}
 */
export function classifyResult(result) {
  if (result.outcome === "pass") return "pass"
  if (result.outcome === "fail") return "fail"
  if (result.rationale.startsWith(NOT_EVALUATED_ACCEPTED)) return "not-evaluated"
  if (result.rationale.startsWith(NOT_EVALUATED_UNEXCEPTED)) return "unexcepted"
  return "warn"
}

/**
 * Merges the evidence documents of the contract's phases into one.
 * @param {readonly { startedAt: string, completedAt: string, checks: Record<string, unknown> }[]} documents
 */
export function mergeEvidence(documents) {
  const started = documents.map((d) => d.startedAt).sort()
  const completed = documents.map((d) => d.completedAt).sort()
  const startedAt = started[0] ?? new Date(0).toISOString()
  const completedAt = completed[completed.length - 1] ?? startedAt
  return {
    version: 1,
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    checks: Object.assign({}, ...documents.map((d) => d.checks)),
  }
}

/**
 * Builds the report document.
 * @param {object} input
 * @param {Record<string, PolicyResultLike>} input.results - every check's verdict, in run order.
 * @param {Record<string, { durationMs: number }>} input.evidenceChecks - every check's evidence.
 * @param {readonly string[]} input.skipped - checks that were deliberately not run.
 * @param {boolean} input.strict - whether an unexcepted "not evaluated" result fails the run.
 * @param {string} input.generatedAt
 * @param {readonly string[]} [input.advisory] - failing checks that do not decide the exit code (adoption mode).
 * @param {readonly string[]} [input.unpromoted] - checks that cannot decide the exit code at all while the
 * package is adopting; strict still applies to every other check. Absent when the package is not adopting.
 */
export function buildReport({
  results,
  evidenceChecks,
  skipped,
  strict,
  generatedAt,
  advisory = [],
  unpromoted,
}) {
  const checks = [
    ...Object.entries(results).map(([id, result]) => ({
      id,
      outcome: result.outcome,
      class: classifyResult(result),
      rationale: result.rationale,
      durationMs: evidenceChecks[id]?.durationMs ?? 0,
    })),
    ...skipped.map((id) => ({
      id,
      outcome: "skipped",
      class: "skipped",
      rationale: "Not run: it spends scarce quota, so it runs only after every other check passed.",
      durationMs: 0,
    })),
  ]
  /** @type {Record<ResultClass, number>} */
  const counts = { pass: 0, warn: 0, "not-evaluated": 0, unexcepted: 0, fail: 0, skipped: 0 }
  for (const check of checks) counts[check.class] += 1
  // A failure of an advisory check (one a package that is adopting has not promoted) is reported
  // but does not decide the exit code. Strict mode stays on during adoption. A promoted check that
  // could not run and has no exception fails the run, as it will once the package is no longer
  // adopting.
  const unexceptedEnforced = checks.filter(
    (check) =>
      check.class === "unexcepted" && !(unpromoted !== undefined && unpromoted.includes(check.id)),
  ).length
  const failed = counts.fail > advisory.length || (strict && unexceptedEnforced > 0)
  return {
    version: 1,
    generatedAt,
    strict,
    passed: !failed,
    counts,
    ...(advisory.length > 0 ? { advisory } : {}),
    totalDurationMs: checks.reduce((sum, c) => sum + c.durationMs, 0),
    checks,
  }
}

const LABEL = {
  fail: "FAIL",
  unexcepted: "NOT EVALUATED, NO EXCEPTION",
  warn: "WARN",
  "not-evaluated": "NOT EVALUATED (accepted)",
  skipped: "SKIPPED",
  pass: "PASS",
}

/** The most of one result's reason the Markdown summary carries; the full text is in report.json. */
const MAX_DETAIL = 2000

/** @param {number} ms */
function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`
}

/** @param {string} text */
function firstLine(text) {
  // Always matches: the pattern accepts the empty string.
  return /[^\n]*/.exec(text)[0]
}

/**
 * Renders the report as Markdown. Totals come first. Then everything that needs attention, most
 * urgent first, with each result's reason. Then the exceptions in force, then the checks and settings
 * compared with the standard. The slowest checks (the contract's own cost) come last.
 * @param {ReturnType<typeof buildReport>} report
 * @param {{ title?: string }} [options]
 */
export function renderMarkdown(report, options = {}) {
  const { counts } = report
  const lines = [
    `## ${options.title ?? "Contract"}: ${report.passed ? "passed" : "FAILED"}${report.strict ? " (strict)" : ""}`,
    ...(report.advisory
      ? [
          "",
          `${String(report.advisory.length)} failing check(s) are advisory, because the package is adopting the standard: ${report.advisory.join(", ")}. They do not fail the run.`,
        ]
      : []),
    "",
    "| Class | Count |",
    "| --- | ---: |",
    ...["fail", "unexcepted", "warn", "not-evaluated", "skipped", "pass"].map(
      (c) => `| ${LABEL[c]} | ${String(counts[c])} |`,
    ),
    "",
  ]
  for (const klass of ["fail", "unexcepted", "warn", "not-evaluated", "skipped"]) {
    const group = report.checks.filter((c) => c.class === klass)
    if (group.length === 0) continue
    lines.push(`### ${LABEL[klass]}`, "")
    for (const check of group) {
      if (klass === "fail" || klass === "unexcepted") {
        // What a reader needs to act without re-running anything: the whole reason, bounded.
        lines.push(
          `#### ${check.id}${report.advisory?.includes(check.id) ? " (advisory)" : ""}`,
          "",
          "```text",
          check.rationale.slice(0, MAX_DETAIL),
          "```",
          "",
        )
      } else {
        lines.push(`- **${check.id}**: ${firstLine(check.rationale)}`)
      }
    }
    lines.push("")
  }
  const inventory = /** @type {any} */ (report).exceptions
  if (inventory && inventory.total > 0) {
    lines.push(
      "### Exceptions in force",
      "",
      `${String(inventory.total)} record(s): ${String(inventory.legacy)} legacy version 1, ${String(inventory.expired)} expired, ${String(inventory.incomplete)} incomplete.`,
      "",
      "| Registry | Records | Legacy | Expired | Incomplete |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...inventory.registries.map(
        (r) =>
          `| ${r.name} | ${String(r.total)} | ${String(r.legacy)} | ${String(r.expired)} | ${String(r.incomplete)} |`,
      ),
      "",
    )
  }
  // A run with no baseline and no tier metadata has nothing to compare, so it gets no section.
  const explanation = /** @type {any} */ (report).explanation
  if (explanation?.baseline !== undefined) {
    lines.push(
      "### Compared with the standard",
      "",
      // renderExplain heads its parts with `###`. One level down, they read as parts of this one section.
      renderExplain(explanation, { format: "markdown", heading: "Loosened" }).replaceAll(
        "\n### ",
        "\n#### ",
      ),
      OWN_CHECKS_NOTE,
      "",
    )
  }
  const slowest = [...report.checks].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5)
  if (slowest.some((c) => c.durationMs > 0)) {
    lines.push("### Slowest checks", "", "| Check | Time |", "| --- | ---: |")
    for (const check of slowest) lines.push(`| ${check.id} | ${seconds(check.durationMs)} |`)
    lines.push("", `Total check time: ${seconds(report.totalDurationMs)}.`, "")
  }
  return lines.join("\n")
}

/**
 * The most a run appends to `$GITHUB_STEP_SUMMARY`, in UTF-8 bytes. GitHub rejects a job summary over 1 MiB
 * (1,048,576 bytes); this leaves room below it.
 */
export const STEP_SUMMARY_MAX_BYTES = 1_000_000

/** Fence lines open and close a code block; an odd count means the cut left one open. */
const FENCE = /^```/gm

/** What a run appends when the job summary has no room left for even the cut note. */
const NO_ROOM =
  "\n**Summary left out: the job summary is full.** The full text is `reports/contract/summary.md`.\n"

/**
 * What a run appends to the GitHub job summary. A summary that fits is passed through whole. A longer one is
 * cut at a line break and ends with a note naming the full report. A code block left open at the cut is
 * closed first, so the note renders as text. With no room for the note, only a one-line pointer is written.
 * `STEP_SUMMARY_MAX_BYTES` sits about 47 KiB under GitHub's limit, which leaves room for it.
 * @param {string} markdown - the whole summary, as `summary.md` holds it.
 * @param {number} [maxBytes] - the most it may write, in UTF-8 bytes.
 * @returns {string} the text to append, ending in a line break.
 */
export function stepSummary(markdown, maxBytes = STEP_SUMMARY_MAX_BYTES) {
  const bytes = Buffer.from(`${markdown}\n`)
  if (bytes.length <= maxBytes) return `${markdown}\n`
  const note = (/** @type {number} */ shown) =>
    `\n**Summary cut at ${String(Math.ceil(shown / 1024))} of ${String(Math.ceil(bytes.length / 1024))} KiB.** GitHub rejects a job summary over 1 MiB. The full text is \`reports/contract/summary.md\`. The reusable contract workflow uploads it as the \`contract-report\` artifact.\n`
  // The note for the whole length is the longest note, so the room it leaves fits any shorter one.
  const room = maxBytes - Buffer.byteLength(note(bytes.length)) - Buffer.byteLength("```\n")
  // Not even the note fits. The pointer alone still tells a reader where the summary went.
  if (room < 0) return NO_ROOM
  // Cutting just after a line break never splits a multi-byte character.
  const head = bytes.subarray(0, bytes.subarray(0, room).lastIndexOf(0x0a) + 1).toString("utf8")
  const open = (head.match(FENCE) ?? []).length % 2 === 1
  return `${head}${open ? "```\n" : ""}${note(Buffer.byteLength(head))}`
}

/**
 * Writes the three report files and returns the Markdown.
 * @param {string} dir - absolute directory, created if missing.
 * @param {{ evidence: unknown, report: ReturnType<typeof buildReport>, markdown: string }} documents
 */
export function writeReportFiles(dir, { evidence, report, markdown }) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(path.join(dir, "summary.md"), `${markdown}\n`)
}
