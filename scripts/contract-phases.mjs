// Plans the two phases of `internal-package-contract`: every check except SecuritySocket first, and
// SecuritySocket only if all of them passed. A Socket scan spends API quota (100 units of a small
// daily budget), so it must never run for a change that is already failing something cheaper.

/** The one check that runs last, and only after every other selected check passed. */
export const DEFERRED_CHECK = "SecuritySocket"

/**
 * @param {readonly string[]} available - every check id in the contract.
 * @param {readonly string[] | undefined} requested - the ids the caller selected (undefined = all).
 * @returns {{ first: readonly string[], deferred: string | undefined }} the ids to run first, and
 *   the deferred check to run after them (undefined when it is not selected or runs alone).
 */
export function planPhases(available, requested) {
  const ids = requested ?? available
  const defer = ids.includes(DEFERRED_CHECK) && ids.length > 1
  return {
    first: defer ? ids.filter((id) => id !== DEFERRED_CHECK) : ids,
    deferred: defer ? DEFERRED_CHECK : undefined,
  }
}
