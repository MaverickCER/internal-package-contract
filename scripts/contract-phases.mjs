// The two phases of a run: every selected check except SecuritySocket first, then SecuritySocket only when all
// of them passed. A Socket scan spends API quota from a small daily budget, so it never runs for a change that is
// already failing something cheaper. SecuritySocket selected on its own runs at once; there is nothing to wait for.

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
