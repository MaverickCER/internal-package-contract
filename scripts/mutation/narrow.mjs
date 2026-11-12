// What a narrowed run (`--scope affected`) changes about mutation testing: only the sources the change affects
// are mutated, and nothing is mutated when there are none.
//
// Every mutant of a source no changed symbol reaches would end as it did the last time; a narrowed run does not
// pay to learn that again. The list comes from the affected analysis, not from the Stryker config's `mutate`
// patterns, so a changed file outside `src/` that the analysis can mutate is mutated too. A run that is not
// narrowed mutates everything the config selects.

/**
 * @param {{ scope: string, mutate?: readonly string[] } | undefined} scope - the scope of the run, when it has one.
 * @returns {{ skip: boolean, args: string[], key: string }} whether there is nothing to mutate, the Stryker arguments
 *   that restrict the run, and a key naming the restriction, which the reuse of an earlier run must take into account.
 */
export function narrowMutation(scope) {
  if (scope?.scope !== "affected") return { skip: false, args: [], key: "" }
  const targets = scope.mutate ?? []
  if (targets.length === 0) return { skip: true, args: [], key: "nothing" }
  const list = targets.join(",")
  return { skip: false, args: ["--mutate", list], key: list }
}
