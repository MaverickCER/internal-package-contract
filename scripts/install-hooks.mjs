// `internal-package-contract install-hooks`: points git at the bundled hooks. `init` does this once, and a
// clone made later runs this command once; the `GitHooks` check warns until it has been. Nothing runs it as
// an install script. It never fails, so it is safe to put in a setup script.

/**
 * @param {{ installed: boolean, packageHooks: string, prefix?: string }} input
 *   `prefix` is where this package sits inside the repository (`git rev-parse --show-prefix`, empty at the root).
 * @returns {string} what `core.hooksPath` should be: the installed copy (relative to the repository root, where
 *   git resolves it, so the setting survives a moved checkout and a package below the root), else this package's
 *   own hooks directory.
 */
export function hooksPathFor({ installed, packageHooks, prefix = "" }) {
  return installed ? `${prefix}node_modules/internal-package-contract/hooks` : packageHooks
}

/**
 * @param {{ inRepo: boolean, installed: boolean, packageHooks: string, prefix?: string, git: (args: string[]) => number, write: (text: string) => void }} input
 * @returns {number} the exit code, always 0.
 */
export function run({ inRepo, installed, packageHooks, prefix, git, write }) {
  if (!inRepo) {
    write("Not a git repository; hooks were not installed.\n")
    return 0
  }
  const hooksPath = hooksPathFor({ installed, packageHooks, prefix })
  if (git(["config", "core.hooksPath", hooksPath]) !== 0) {
    write("git config core.hooksPath failed; hooks were not installed.\n")
    return 0
  }
  write(`git core.hooksPath -> ${hooksPath}\n`)
  return 0
}
