// The check selection `bin/contract.mjs` and `scripts/run-contract.mjs` share.
//
//   --checks a,b   / --only a,b    run only these checks
//   --skip c,d                     run every check except these
//
// A name the contract does not declare is refused before anything runs, with the closest declared name as a
// hint. `--skip` is how the bundled pre-push hook leaves out Coverage, Crap and Mutation: a deny-list, so a check
// added later is in the pre-push set unless it is named there.

import { nearest } from "./contract-help.mjs"

/** @param {string} value */
function splitIds(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * @param {readonly string[]} argv
 * @param {readonly string[]} names - flag names without dashes, first match wins
 * @returns {string | undefined} the raw value, or undefined when the flag is absent
 */
function flagValue(argv, names) {
  for (const name of names) {
    const eq = argv.find((a) => a.startsWith(`--${name}=`))
    if (eq !== undefined) return eq.slice(name.length + 3)
    const idx = argv.indexOf(`--${name}`)
    if (idx !== -1) return argv[idx + 1] ?? ""
  }
  return undefined
}

/**
 * @param {readonly string[]} argv - `process.argv`
 * @param {readonly string[]} available - every check id the contract declares
 * @returns {readonly string[] | undefined} the ids to run, or undefined for "everything"
 * @throws {Error} when `--skip` or `--checks` names a check the contract does not declare
 */
export function selectChecks(argv, available) {
  const only = flagValue(argv, ["checks", "only"])
  const skip = flagValue(argv, ["skip"])
  const known = new Set(available)
  const requested = only === undefined ? undefined : splitIds(only)
  const skipped = skip === undefined ? [] : splitIds(skip)
  for (const id of [...(requested ?? []), ...skipped]) {
    if (!known.has(id)) {
      const closest = nearest(id, available)
      throw Object.assign(
        new Error(
          `Unknown check "${id}".${closest === undefined ? "" : ` Did you mean ${closest}?`} Declared checks: ${available.join(", ")}.`,
        ),
        { usage: true },
      )
    }
  }
  if (requested === undefined && skipped.length === 0) return undefined
  const base = requested ?? available
  return base.filter((id) => !skipped.includes(id))
}
