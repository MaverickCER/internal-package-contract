// `internal-package-contract install-hooks`: points git at the bundled hooks. `init` does this once, and a
// clone made later runs this command once; the `GitHooks` check warns until it has been. Nothing runs it as
// an install script. It never fails, so it is safe to put in a setup script.

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
