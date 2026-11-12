// What a mutation report must look like before anything judges it or builds on it: a `files` object with at least
// one entry, each with a `mutants` array, and each mutant with a status Stryker can report. Anything else is not
// evidence: a file with `mutants: null` or a mutant without a status would be skipped by the policy, so a report
// could pass having judged less than it appears to.

/** The statuses Stryker gives a mutant. */
const STATUSES = new Set([
  "Killed",
  "Survived",
  "NoCoverage",
  "Timeout",
  "CompileError",
  "RuntimeError",
  "Ignored",
  "Pending",
])

/**
 * @param {unknown} report - a parsed mutation report.
 * @returns {string | undefined} what is wrong with the report's shape, or `undefined` when it is sound.
 */
export function reportShapeError(report) {
  const files = report?.files
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    return "it has no `files` object."
  }
  const names = Object.keys(files)
  if (names.length === 0) return "it has no file in it."
  for (const name of names) {
    const mutants = files[name]?.mutants
    if (!Array.isArray(mutants)) return `${name} has no \`mutants\` array.`
    for (const mutant of mutants) {
      if (!STATUSES.has(mutant?.status)) {
        return `${name} has a mutant whose status is ${JSON.stringify(mutant?.status)}, which Stryker does not report.`
      }
    }
  }
  return undefined
}
