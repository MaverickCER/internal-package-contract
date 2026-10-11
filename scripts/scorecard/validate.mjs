// A public package publishes its OpenSSF Scorecard result so anyone can see it live (the README badge
// reads it). Publishing has requirements of its own: the scorecard action pinned to a commit, results
// published, the OIDC token permission that signs them, and a schedule so the score does not go stale
// between pushes.

const ACTION = "ossf/scorecard-action@"

/** A workflow line without its indentation, a leading list dash, or a trailing comment. */
function clean(line) {
  const hash = line.indexOf(" #")
  const code = (hash === -1 ? line : line.slice(0, hash)).trim()
  return code.startsWith("- ") ? code.slice(2) : code
}

/**
 * @param {string} workflow - the text of a workflow file.
 * @returns {string[]} its meaningful lines, cleaned.
 */
function meaningful(workflow) {
  return workflow.split("\n").map(clean)
}

/**
 * @param {string} workflow - the text of a workflow file.
 * @returns {boolean} whether it runs the scorecard action.
 */
function runsScorecard(workflow) {
  return meaningful(workflow).some((line) => line.startsWith(`uses: ${ACTION}`))
}

/**
 * @param {string} workflow - the text of a workflow file that runs `ossf/scorecard-action`.
 * @returns {string[]} one sentence per problem; empty when the workflow publishes correctly.
 */
export function validateScorecardWorkflow(workflow) {
  const lines = meaningful(workflow)
  const problems = []
  const use = lines.find((line) => line.startsWith(`uses: ${ACTION}`))
  if (!/^[0-9a-f]{40}$/.test(use?.slice(`uses: ${ACTION}`.length))) {
    problems.push("the scorecard action must be pinned to a full commit SHA.")
  }
  if (!lines.includes("publish_results: true")) {
    problems.push("the scorecard action must set `publish_results: true` so the result is public.")
  }
  if (!lines.includes("id-token: write")) {
    problems.push("the scorecard job needs the `id-token: write` permission to sign its result.")
  }
  if (!lines.includes("schedule:")) {
    problems.push("the workflow needs a `schedule:` trigger so the score does not go stale.")
  }
  return problems
}

/**
 * @param {{ name: string, text: string }[]} workflows - every workflow file in the package.
 * @returns {string[]} problems prefixed with the file they are in; one problem when no workflow runs the action.
 */
export function validateScorecardWorkflows(workflows) {
  const scorecard = workflows.filter(({ text }) => runsScorecard(text))
  if (scorecard.length === 0) {
    return [
      "no workflow in .github/workflows runs `ossf/scorecard-action`, so the package publishes no Scorecard result.",
    ]
  }
  return scorecard.flatMap(({ name, text }) =>
    validateScorecardWorkflow(text).map((problem) => `${name}: ${problem}`),
  )
}
