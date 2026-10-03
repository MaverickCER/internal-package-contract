// The durable record of a contract run, shared by `bin/contract.mjs` and `scripts/run-contract.mjs`.
//
// A run produces repo-contract's `Evidence` (what each check executed) and `Verdict` (what the
// repository's own policy concluded). Printing them and throwing them away leaves nothing a
// reviewer, a dashboard or a later run can read, so this module turns them into:
//
//   reports/contract/evidence.json   the merged evidence of every phase, validated against
//                                    repo-contract's own `Evidence` shape (version 1)
//   reports/contract/report.json     the verdict plus per-check class, timing and run totals
//   reports/contract/summary.md      the same, as Markdown, written to $GITHUB_STEP_SUMMARY in CI
//
// `warn` is overloaded -- "a real but non-blocking finding" and "this could not be evaluated here"
// read the same -- so each result is also given a CLASS (see `classifyResult`). A run that is
// yellow only because of unexplained "not evaluated" results is not the same as one that is green.

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

/** Starts a rationale whose check could not run here and that an exception record has accepted. */
export const NOT_EVALUATED_ACCEPTED = "Not evaluated (accepted by"
/** Starts a rationale whose check could not run here and that no exception record covers. */
export const NOT_EVALUATED_UNEXCEPTED = "Not evaluated (no exception recorded"

/**
 * @typedef {"pass" | "warn" | "not-evaluated" | "unexcepted" | "fail" | "skipped"} ResultClass
 * @typedef {{ outcome: string, rationale: string }} PolicyResultLike
 */

/**
 * The class of one check's result.
 * - `pass` / `fail` -- as the policy said.
 * - `warn` -- a real finding that does not block.
 * - `not-evaluated` -- the check could not run here, and a recorded exception accepts that.
 * - `unexcepted` -- the check could not run here and nothing records why that is acceptable.
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
 */
export function buildReport({ results, evidenceChecks, skipped, strict, generatedAt }) {
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
  const failed = counts.fail > 0 || (strict && counts.unexcepted > 0)
  return {
    version: 1,
    generatedAt,
    strict,
    passed: !failed,
    counts,
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
  return text.split("\n", 1)[0] ?? ""
}

/**
 * Renders the report as Markdown: totals first, then everything that needs attention in order of
 * how much it needs it, with each result's reason, then the slowest checks (the contract's own cost).
 * @param {ReturnType<typeof buildReport>} report
 * @param {{ title?: string }} [options]
 */
export function renderMarkdown(report, options = {}) {
  const { counts } = report
  const lines = [
    `## ${options.title ?? "Contract"}: ${report.passed ? "passed" : "FAILED"}${report.strict ? " (strict)" : ""}`,
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
          `#### ${check.id}`,
          "",
          "```text",
          check.rationale.slice(0, MAX_DETAIL),
          "```",
          "",
        )
      } else {
        lines.push(`- **${check.id}** -- ${firstLine(check.rationale)}`)
      }
    }
    lines.push("")
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
