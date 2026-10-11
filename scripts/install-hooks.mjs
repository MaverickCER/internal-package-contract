// `internal-package-contract install-hooks`: points git at the bundled hooks. `init` does this once; a
// package's `prepare` script runs this on every `npm install`, so a fresh clone is covered without
// anyone remembering to run `init`. It never fails: an install must not break because git is missing.

/**
 * @param {{ installed: boolean, packageHooks: string }} input
 * @returns {string} what `core.hooksPath` should be: the installed copy (relative, so the setting
 *   survives a moved checkout), else this package's own hooks directory.
 */
export function hooksPathFor({ installed, packageHooks }) {
  return installed ? "node_modules/internal-package-contract/hooks" : packageHooks
}

/**
 * @param {{ inRepo: boolean, installed: boolean, packageHooks: string, git: (args: string[]) => number, write: (text: string) => void }} input
 * @returns {number} the exit code, always 0.
 */
export function run({ inRepo, installed, packageHooks, git, write }) {
  if (!inRepo) {
    write("Not a git repository; hooks were not installed.\n")
    return 0
  }
  const hooksPath = hooksPathFor({ installed, packageHooks })
  if (git(["config", "core.hooksPath", hooksPath]) !== 0) {
    write("git config core.hooksPath failed; hooks were not installed.\n")
    return 0
  }
  write(`git core.hooksPath -> ${hooksPath}\n`)
  return 0
}
