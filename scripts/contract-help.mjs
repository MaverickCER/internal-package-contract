// The usage text of `internal-package-contract`. Kept out of the dispatcher so the public surface the
// SurfaceContract check snapshots (this text) is tested, and so `--help` never reaches code that would
// run the contract.

/** @param {readonly string[]} argv - the arguments after the script name. */
export function wantsHelp(argv) {
  return argv.includes("--help") || argv.includes("-h")
}

/** @returns {string} the usage text, ending in a newline. */
export function helpText() {
  return `Usage: internal-package-contract [command] [options]

Commands:
  (none)                     run the whole contract
  init                       scaffold repo files and git wiring
  exceptions                 list every exception registry: counts by type, legacy, expired
  sync-benchmark-guides      copy the canonical benchmark guides into benchmarks/
  update-baseline            regenerate the API and surface baselines after a release

Options (when running the contract):
  --checks a,b               run only checks a and b (and what they depend on)
  --skip a,b                 run every check except a and b
  --strict                   also fail on a "not evaluated" result no exception covers
                             (the default under CI)
  --no-strict                turn --strict off under CI
  -h, --help                 print this text and exit
`
}
