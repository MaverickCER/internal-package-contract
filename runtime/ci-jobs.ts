/**
 * Reads a GitHub Actions workflow and says which of its jobs the `required` aggregator does not wait for.
 *
 * The ruleset requires two contexts, `contract` and `required`; `required` is the one job that waits for every
 * other gate job (`needs`) and fails unless each finished with success. A job added to the workflow without
 * being added to `required.needs` is advisory from that day on, and nothing says so. This is the test that says
 * so, carried into every package as a managed copy (`test/_ipc/ci-jobs.ts`, with `test/ci-jobs.test.ts`).
 *
 * Not a YAML parser. It recognises the layout every workflow in the fleet uses -- job ids as two-space-indented
 * keys under a top-level `jobs:`, `needs:` written inline (`[a, b]`) or as a block list, `continue-on-error:
 * true` as a job's own key -- and reports a workflow it cannot read that way as a problem, never as green.
 */

export interface CiJob {
  readonly id: string
  /** The jobs this one waits for. */
  readonly needs: readonly string[]
  /** Whether a failure of this job is tolerated by the workflow (`continue-on-error: true` on the job). */
  readonly continueOnError: boolean
}

export interface CiJobsOptions {
  /** The aggregator job; `required`. */
  readonly aggregator: string
  /**
   * Jobs the aggregator need not wait for: the two the ruleset requires itself, the aggregator, and jobs that
   * publish or decorate rather than gate.
   */
  readonly exempt: readonly string[]
  /** Jobs that are allowed to fail, and must say so with `continue-on-error: true` (a preview of the next Node). */
  readonly advisory: readonly string[]
}

/** The fleet's own layout: what every scaffolded `contract.yml` and the three public packages' `ci.yml` use. */
export const DEFAULT_CI_JOBS_OPTIONS: CiJobsOptions = Object.freeze({
  aggregator: "required",
  exempt: Object.freeze([
    "contract",
    "lint",
    "required",
    "badges",
    "deploy",
    "pages-content",
    "pr-title",
  ]),
  advisory: Object.freeze(["verify-current"]),
})

/**
 * @param manifest - a parsed `package.json`.
 * @returns the options, with whatever `"internal-package-contract": { "ciJobs": { ... } }` overrides.
 */
export function ciJobsOptions(manifest: unknown): CiJobsOptions {
  const section = (
    manifest as { "internal-package-contract"?: { ciJobs?: Partial<CiJobsOptions> } }
  )["internal-package-contract"]?.ciJobs
  return {
    aggregator: section?.aggregator ?? DEFAULT_CI_JOBS_OPTIONS.aggregator,
    exempt: section?.exempt ?? DEFAULT_CI_JOBS_OPTIONS.exempt,
    advisory: section?.advisory ?? DEFAULT_CI_JOBS_OPTIONS.advisory,
  }
}

const JOB_ID = /^ {2}([A-Za-z_][\w-]*):\s*$/
const JOB_KEY = /^ {4}([\w-]+):/
const LIST_ITEM = /^ {6,}- *(.+?)\s*$/

/** @param item - one trimmed scalar. @returns it without the quotes YAML allows around it. */
// Stryker disable next-line Regex: equivalent -- a job id holds no quote, so the anchors are only precision.
const unquote = (item: string): string => item.replace(/^['"]|['"]$/g, "")

/** @param text - a trimmed inline YAML flow sequence or scalar. @returns its items, unquoted. */
function inlineList(text: string): string[] {
  // Stryker disable next-line Regex: equivalent -- a job id holds no bracket, so the anchors are only precision.
  const inner = text.replace(/^\[|\]$/g, "")
  return inner
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter((item) => item !== "")
}

/**
 * @param workflow - the text of a workflow file.
 * @returns every job, in order; empty when the file has no `jobs:` section.
 */
export function parseJobs(workflow: string): CiJob[] {
  /** Each job as it is read; `inNeeds` is whether the lines being read are the items of its `needs:` block. */
  const jobs: { id: string; needs: string[]; continueOnError: boolean; inNeeds: boolean }[] = []
  let inJobs = false
  for (const line of workflow.split("\n")) {
    if (/^\S/.test(line)) {
      inJobs = line.trimEnd() === "jobs:"
      continue
    }
    if (!inJobs) continue
    const id = JOB_ID.exec(line)
    if (id?.[1] !== undefined) {
      jobs.push({ id: id[1], needs: [], continueOnError: false, inNeeds: false })
      continue
    }
    const current = jobs[jobs.length - 1]
    if (current === undefined) continue
    const key = JOB_KEY.exec(line)
    if (key?.[1] !== undefined) {
      // The text after the first colon, which the key pattern guarantees follows the name.
      const value = line.slice(line.indexOf(":") + 1).trim()
      current.inNeeds = key[1] === "needs" && value === ""
      if (key[1] === "needs") current.needs.push(...inlineList(value))
      else if (key[1] === "continue-on-error" && value === "true") current.continueOnError = true
      continue
    }
    const item = current.inNeeds ? LIST_ITEM.exec(line) : null
    if (item?.[1] !== undefined) current.needs.push(...inlineList(item[1]))
  }
  return jobs.map(({ id, needs, continueOnError }) => ({ id, needs, continueOnError }))
}

/**
 * @param workflow - the text of the workflow file.
 * @param options - which job aggregates, which are exempt, which are advisory.
 * @returns every problem, each a sentence; none when every gate job is waited for.
 */
export function auditCiJobs(
  workflow: string,
  options: CiJobsOptions = DEFAULT_CI_JOBS_OPTIONS,
): string[] {
  const jobs = parseJobs(workflow)
  if (jobs.length === 0) return ["the workflow has no `jobs:` section this audit can read"]
  const ids = new Set(jobs.map((job) => job.id))
  const aggregator = jobs.find((job) => job.id === options.aggregator)
  if (aggregator === undefined) return [`the workflow has no \`${options.aggregator}\` job`]
  const problems: string[] = []
  const skip = new Set([...options.exempt, ...options.advisory, options.aggregator])
  for (const job of jobs) {
    if (!skip.has(job.id) && !aggregator.needs.includes(job.id)) {
      problems.push(
        `\`${job.id}\` is not in \`${options.aggregator}.needs\`, so its result does not block a merge`,
      )
    }
  }
  for (const needed of aggregator.needs) {
    if (!ids.has(needed)) {
      problems.push(`\`${options.aggregator}.needs\` names \`${needed}\`, which is not a job`)
    }
  }
  for (const id of options.advisory) {
    const job = jobs.find((candidate) => candidate.id === id)
    if (job !== undefined && !job.continueOnError) {
      problems.push(`\`${id}\` is advisory but does not carry \`continue-on-error: true\``)
    }
  }
  return problems
}
