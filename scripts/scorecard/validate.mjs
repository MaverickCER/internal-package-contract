// A public package publishes its OpenSSF Scorecard result so anyone can see it live (the README badge
// reads it). Publishing has requirements of its own: the scorecard action pinned to a commit, results
// published, the OIDC token permission that signs them, and a schedule so the score does not go stale
// between pushes.

/** The workflow text a package's scorecard job lives in, as the first line that names the action. */
const ACTION = /^\s*-?\s*uses:\s*ossf\/scorecard-action@(\S+)/m

/**
 * @param {string} workflow - the text of a workflow file that runs `ossf/scorecard-action`.
 * @returns {string[]} one sentence per problem; empty when the workflow publishes correctly.
 */
export function validateScorecardWorkflow(workflow) {
  const problems = []
  const reference = ACTION.exec(workflow)?.[1] ?? ""
  if (!/^[0-9a-f]{40}$/.test(reference.split(/\s/)[0] ?? "")) {
    problems.push("the scorecard action must be pinned to a full commit SHA.")
  }
  if (!/^\s*publish_results:\s*true\s*$/m.test(workflow)) {
    problems.push("the scorecard action must set `publish_results: true` so the result is public.")
  }
  if (!/^\s*id-token:\s*write\s*$/m.test(workflow)) {
    problems.push("the scorecard job needs the `id-token: write` permission to sign its result.")
  }
  if (!/^\s*schedule:\s*$/m.test(workflow)) {
    problems.push("the workflow needs a `schedule:` trigger so the score does not go stale.")
  }
  return problems
}

/**
 * @param {{ name: string, text: string }[]} workflows - every workflow file in the package.
 * @returns {string[]} problems prefixed with the file they are in; one problem when no workflow runs the action.
 */
export function validateScorecardWorkflows(workflows) {
  const scorecard = workflows.filter(({ text }) => ACTION.test(text))
  if (scorecard.length === 0) {
    return [
      "no workflow in .github/workflows runs `ossf/scorecard-action`, so the package publishes no Scorecard result.",
    ]
  }
  return scorecard.flatMap(({ name, text }) =>
    validateScorecardWorkflow(text).map((problem) => `${name}: ${problem}`),
  )
}
