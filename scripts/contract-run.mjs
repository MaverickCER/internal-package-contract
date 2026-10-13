// The run loop `bin/contract.mjs` (a consumer's contract) and `scripts/run-contract.mjs` (this
// repository's own self-hosting contract) share: select the checks, run them in the two phases of
// `planPhases`, print the verdict, and -- unlike a bare print-and-discard -- keep a durable record
// of what happened (see `scripts/contract-report.mjs`).

import { appendFileSync, existsSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"
import { changedFiles, selectChanged } from "./changed.mjs"
import { selectChecks } from "./contract-args.mjs"
import { parseRunOptions } from "./contract-options.mjs"
import {
  onEvidenceSaveToRepoContractLogs,
  onVerdictPrependRepoContractLogs,
  REPO_CONTRACT_LOG_DIRECTORY as LOG_DIRECTORY,
  repoContractLogs,
} from "repo-contract/helpers"
import { advisoryFailures, readAdoption } from "./adoption/mode.mjs"
import { prepare as prepareRun } from "./contract-prepare.mjs"
import { planPhases } from "./contract-phases.mjs"
import { collectInventory, renderInventory } from "./exceptions-inventory.mjs"
import { buildReport, mergeEvidence, renderMarkdown, writeReportFiles } from "./contract-report.mjs"

/** Where the durable report is written, relative to the repository root. It survives the cleanup below. */
export const REPORT_DIR = "reports/contract"

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

/** Where output goes when it is not wanted. */
const nowhere = {
  write() {
    // Discarded on purpose.
  },
}

/**
 * @param {{ status: string, exitCode: number | null }} evidence - how a check's process ended.
 * @returns {string} what to add to its progress line: nothing when it ended normally with code 0, else why the verdict will probably fail.
 */
export function processTrouble(evidence) {
  if (evidence.status !== "completed") return ` -- ${evidence.status}`
  return evidence.exitCode === 0 ? "" : ` -- exit code ${String(evidence.exitCode)}`
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
 * @param {NodeJS.WritableStream} [input.err] - where notes about the environment (not the verdict) go.
 * @param {(input: { cwd: string, out: NodeJS.WritableStream }) => void} [input.prepare] - builds what the checks expect on disk; a test seam.
 * @param {(cwd: string) => string[] | undefined} [input.changed] - the files that changed, for `--changed`; a test seam.
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
  err = process.stderr,
  prepare = prepareRun,
  changed = changedFiles,
}) {
  const options = parseRunOptions(argv, env, cwd)
  // `--json` prints one JSON document on stdout and nothing else, so everything meant for a person goes nowhere.
  const human = options.json ? nowhere : out
  const available = Object.keys(config.checks)
  // A mistyped check name is reported before anything is built, not after the benchmark page.
  let checkIds = selectChecks(argv, available)
  prepare({ cwd, out: human })
  if (options.changed) {
    const files = changed(cwd)
    if (files === undefined) {
      human.write("[contract] --changed: git could not say what changed, so every check runs.\n")
    } else {
      const picked = selectChanged(files, available)
      if (picked.ids !== undefined) {
        const ids = picked.ids
        checkIds = checkIds === undefined ? ids : checkIds.filter((id) => ids.includes(id))
      }
      human.write(
        `[contract] --changed: ${picked.reason}; running ${String((checkIds ?? available).length)} of ${String(available.length)} checks.\n`,
      )
    }
  }
  const strict = isStrict(argv, env)
  const created = {
    coverage: !existsSync(path.join(cwd, "coverage")),
    reports: !existsSync(path.join(cwd, "reports")),
  }

  // A log is written the moment a check's evidence exists, and rewritten to lead with the verdict once it is
  // known. A disk problem is reported once and never stops the run.
  const logOptions = {
    cwd,
    mode: options.logs,
    onProblem: (message) => human.write(`[contract] ${message}\n`),
  }
  const saveEvidence = onEvidenceSaveToRepoContractLogs(logOptions)
  const prependVerdict = onVerdictPrependRepoContractLogs(logOptions)
  const logs = repoContractLogs(logOptions)
  const total = (checkIds ?? available).length
  let finished = 0
  const progress = {
    onEvidence: (id, evidence) => {
      saveEvidence(id, evidence)
      finished += 1
      human.write(
        `[contract] ${id} finished in ${(evidence.durationMs / 1000).toFixed(1)}s (${String(finished)} of ${String(total)})${processTrouble(evidence)}\n`,
      )
    },
    // The verdict goes to the top of the check's log the moment the policy returns it; a failure is also
    // said on the console at once, ahead of the full report. The report's own classification (advisory,
    // not evaluated) rewrites the label once it is known.
    onVerdict: (id, result) => {
      prependVerdict(id, result)
      if (result.outcome === "fail") {
        human.write(`[contract] FAIL ${id}: ${result.rationale.split("\n")[0]}\n`)
      }
    },
  }

  // Phase 1 is every check but SecuritySocket; the Socket scan (which spends API quota) runs second,
  // and only if phase 1 passed -- see scripts/contract-phases.mjs.
  const { first, deferred } = planPhases(available, checkIds)
  const results = {}
  const documents = []
  let passed
  let skippedDeferred = false
  try {
    const phaseOne = await runRepoContract(config, {
      ...(deferred || checkIds ? { checks: first } : {}),
      ...progress,
    })
    documents.push(phaseOne.evidence)
    Object.assign(results, phaseOne.verdict.checks)
    passed = phaseOne.verdict.passed
    if (deferred !== undefined) {
      if (passed) {
        const phaseTwo = await runRepoContract(config, { checks: [deferred], ...progress })
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
  if (finished === 0 && Object.keys(evidence.checks).length > 0) {
    err.write(
      "[contract] The installed repo-contract does not report checks as they finish (it needs 0.11.0 or later), so progress and logs appear only now. Upgrade it for live results.\n",
    )
  }
  // A package that is adopting the standard sees every error in full, but only the checks it has promoted can
  // fail the run.
  const adoption = readAdoption(cwd)
  const advisory = advisoryFailures(results, adoption)
  const report = buildReport({
    results,
    advisory,
    evidenceChecks: evidence.checks,
    skipped: skippedDeferred ? [deferred] : [],
    strict: strict && adoption.state !== "active",
    generatedAt: new Date().toISOString(),
  })
  const labelOf = (check) =>
    check.class === "unexcepted"
      ? "NOT-EVALUATED"
      : advisory.includes(check.id)
        ? "FAIL (advisory)"
        : check.outcome.toUpperCase()
  // An engine that reports nothing as it goes still gets its logs, from what it returned.
  for (const check of report.checks) {
    const raw = evidence.checks[check.id]
    if (raw === undefined) continue
    // Stryker disable next-line ConditionalExpression: equivalent -- saving the evidence again before the verdict is rewritten ends in the same file.
    if (!logs.has(check.id)) logs.saveEvidence(check.id, raw)
    logs.prependVerdict(check.id, labelOf(check), check.rationale, check.outcome === "pass")
  }
  await logs.flush()
  const exceptions = collectInventory(cwd)
  const markdown = renderMarkdown({ ...report, exceptions }, { title })
  writeReportFiles(path.join(cwd, REPORT_DIR), {
    evidence,
    report: { ...report, exceptions },
    markdown,
  })
  if (env["GITHUB_STEP_SUMMARY"]) appendFileSync(env["GITHUB_STEP_SUMMARY"], `${markdown}\n`)

  process.exitCode = report.passed ? 0 : 1
  if (options.json) {
    out.write(`${JSON.stringify({ ...report, exceptions }, null, 2)}\n`)
    return { passed: report.passed }
  }

  out.write(`\n${title}${checkIds ? ` (${checkIds.join(", ")})` : ""}\n\n`)
  for (const check of report.checks) {
    out.write(`[${labelOf(check)}] ${check.id}: ${check.rationale}\n`)
  }
  const { counts } = report
  out.write(
    `\n${String(counts.pass)} pass, ${String(counts.warn)} warn, ${String(counts["not-evaluated"])} not evaluated (accepted), ${String(counts.unexcepted)} not evaluated (no exception recorded), ${String(counts.fail)} fail, ${String(counts.skipped)} skipped.\n`,
  )
  if (advisory.length > 0) {
    out.write(
      `Adoption mode: ${String(advisory.length)} failing check(s) are advisory and do not fail the run (${advisory.join(", ")}). Fix one, then \`internal-package-contract promote <Check>\`.\n`,
    )
  }
  if (counts.unexcepted > 0 && !strict) {
    out.write(
      "Results with no recorded exception fail the CI gate (--strict); record each in .repo-contract/exceptions/environment.json.\n",
    )
  }
  if (exceptions.total > 0) out.write(`\n${renderInventory(exceptions)}`)
  out.write(`Report: ${path.join(REPORT_DIR, "report.json")}\n`)
  if (logs.count() > 0)
    out.write(
      `Logs: ${LOG_DIRECTORY.split(path.sep).join("/")}/<Check>.log (${options.logs === "all" ? "every check" : "checks that did not pass"})\n`,
    )
  out.write(`\n${report.passed ? "PASS" : "FAIL"}\n`)
  return { passed: report.passed }
}
