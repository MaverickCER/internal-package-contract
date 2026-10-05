// The run loop `bin/contract.mjs` (a consumer's contract) and `scripts/run-contract.mjs` (this
// repository's own self-hosting contract) share: select the checks, run them in the two phases of
// `planPhases`, print the verdict, and -- unlike a bare print-and-discard -- keep a durable record
// of what happened (see `scripts/contract-report.mjs`).

import { appendFileSync, existsSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"
import { selectChecks } from "./contract-args.mjs"
import { planPhases } from "./contract-phases.mjs"
import { collectInventory, renderInventory } from "./exceptions-inventory.mjs"
import { buildReport, mergeEvidence, renderMarkdown, writeReportFiles } from "./contract-report.mjs"

/** Where the durable report is written, relative to the repository root. It survives the cleanup below. */
export const REPORT_DIR = path.join("reports", "contract")

/** @param {NodeJS.ProcessEnv} env */
export function isCi(env) {
  const ci = env["CI"]
  return (Boolean(ci) && ci !== "false" && ci !== "0") || env["GITHUB_ACTIONS"] === "true"
}

/**
 * Whether an unexcepted "not evaluated" result fails the run: always under `--strict`, by default
 * in CI (the gate), never under `--no-strict`.
 * @param {readonly string[]} argv
 * @param {NodeJS.ProcessEnv} env
 */
export function isStrict(argv, env) {
  if (argv.includes("--no-strict")) return false
  return argv.includes("--strict") || isCi(env)
}

/**
 * Removes what a run generated so it does not trip the NEXT run's Lint/Format/DeadCode or the
 * consumer's own `prettier --check .`: Stryker's sandbox always; `coverage/` and the tool reports in
 * `reports/` only if the repository had none before the run. `reports/contract` is the one thing
 * that stays -- it is the contract's own record, and `reports/` is git-ignored.
 * @param {string} cwd
 * @param {{ coverage: boolean, reports: boolean }} created - what did not exist before the run.
 */
export function cleanUp(cwd, created) {
  rmSync(path.join(cwd, ".stryker-tmp"), { recursive: true, force: true })
  if (created.coverage) rmSync(path.join(cwd, "coverage"), { recursive: true, force: true })
  const reports = path.join(cwd, "reports")
  if (created.reports && existsSync(reports)) {
    for (const entry of readdirSync(reports)) {
      if (entry !== "contract") rmSync(path.join(reports, entry), { recursive: true })
    }
  }
}

/**
 * Runs the selected checks, prints the verdict, writes the report, sets the exit code.
 * @param {object} input
 * @param {(config: unknown, options?: { checks: readonly string[] }) => Promise<{ evidence: any, verdict: any }>} input.runRepoContract
 * @param {{ checks: Record<string, unknown> }} input.config
 * @param {string} input.cwd - the repository root; the report and cleanup are relative to it.
 * @param {string} input.title - the heading printed above the results.
 * @param {readonly string[]} [input.argv]
 * @param {NodeJS.ProcessEnv} [input.env]
 * @param {NodeJS.WritableStream} [input.out]
 * @returns {Promise<{ passed: boolean }>}
 */
export async function runContract({
  runRepoContract,
  config,
  cwd,
  title,
  argv = process.argv,
  env = process.env,
  out = process.stdout,
}) {
  const available = Object.keys(config.checks)
  const checkIds = selectChecks(argv, available)
  const strict = isStrict(argv, env)
  const created = {
    coverage: !existsSync(path.join(cwd, "coverage")),
    reports: !existsSync(path.join(cwd, "reports")),
  }

  // Phase 1 is every check but SecuritySocket; the Socket scan (which spends API quota) runs second,
  // and only if phase 1 passed -- see scripts/contract-phases.mjs.
  const { first, deferred } = planPhases(available, checkIds)
  const results = {}
  const documents = []
  let passed
  let skippedDeferred = false
  try {
    const phaseOne = await runRepoContract(
      config,
      deferred || checkIds ? { checks: first } : undefined,
    )
    documents.push(phaseOne.evidence)
    Object.assign(results, phaseOne.verdict.checks)
    passed = phaseOne.verdict.passed
    if (deferred !== undefined) {
      if (passed) {
        const phaseTwo = await runRepoContract(config, { checks: [deferred] })
        documents.push(phaseTwo.evidence)
        Object.assign(results, phaseTwo.verdict.checks)
        passed = phaseTwo.verdict.passed
      } else {
        skippedDeferred = true
      }
    }
  } finally {
    cleanUp(cwd, created)
  }

  const evidence = mergeEvidence(documents)
  const report = buildReport({
    results,
    evidenceChecks: evidence.checks,
    skipped: skippedDeferred ? [deferred] : [],
    strict,
    generatedAt: new Date().toISOString(),
  })
  const exceptions = collectInventory(cwd)
  const markdown = renderMarkdown({ ...report, exceptions }, { title })
  writeReportFiles(path.join(cwd, REPORT_DIR), {
    evidence,
    report: { ...report, exceptions },
    markdown,
  })
  if (env["GITHUB_STEP_SUMMARY"]) appendFileSync(env["GITHUB_STEP_SUMMARY"], `${markdown}\n`)

  out.write(`\n${title}${checkIds ? ` (${checkIds.join(", ")})` : ""}\n\n`)
  for (const check of report.checks) {
    const label = check.class === "unexcepted" ? "NOT-EVALUATED" : check.outcome.toUpperCase()
    out.write(`[${label}] ${check.id}: ${check.rationale}\n`)
  }
  const { counts } = report
  out.write(
    `\n${String(counts.pass)} pass, ${String(counts.warn)} warn, ${String(counts["not-evaluated"])} not evaluated (accepted), ${String(counts.unexcepted)} not evaluated (no exception recorded), ${String(counts.fail)} fail, ${String(counts.skipped)} skipped.\n`,
  )
  if (counts.unexcepted > 0 && !strict) {
    out.write(
      "Results with no recorded exception fail the CI gate (--strict); record each in .repo-contract/exceptions/environment.json.\n",
    )
  }
  if (exceptions.total > 0) out.write(`\n${renderInventory(exceptions)}`)
  out.write(`Report: ${path.join(REPORT_DIR, "report.json")}\n`)
  out.write(`\n${report.passed ? "PASS" : "FAIL"}\n`)
  process.exitCode = report.passed ? 0 : 1
  return { passed: report.passed }
}
