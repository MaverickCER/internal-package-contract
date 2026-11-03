// What a narrowed run changes about mutation testing: only the sources a change affects are mutated.
//
// Every mutant of a source that no changed symbol reaches would be killed, or survive, exactly as it did the last
// time that source was mutated; spending an hour to find that out again is what a narrowed run avoids. A run that is
// not narrowed mutates everything, as it always has.

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
