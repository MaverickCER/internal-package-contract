// Parses the check selection shared by `bin/contract.mjs` and `scripts/run-contract.mjs`:
//
//   --checks a,b   / --only a,b    run only these checks (and their dependencies)
//   --skip c,d                     run every check EXCEPT these
//
// `--skip` is how the bundled pre-push hook leaves out the slow analyses without an allow-list that
// silently excludes every check added later (a new check is in the pre-push set unless named here).

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
      throw new Error(`Unknown check "${id}". Declared checks: ${available.join(", ")}.`)
    }
  }
  if (requested === undefined && skipped.length === 0) return undefined
  const base = requested ?? available
  return base.filter((id) => !skipped.includes(id))
}
