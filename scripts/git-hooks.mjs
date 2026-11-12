// Whether git in this clone is using the bundled internal-package-contract hooks. The hooks run the
// contract before a commit and a push, so a clone without them finds its failures in CI instead. The
// answer is `ci` under CI (the `CI` variable set to anything but `false` or `0`, or GitHub Actions),
// `not-a-repo` outside a repository, and `installed` only when `core.hooksPath` resolves to the bundled
// hooks/ directory itself. Anything else, including a path that cannot be resolved, is `missing`.

/**
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {boolean} whether this is a CI run (`CI` set to a truthy value, or GitHub Actions).
 */
export function isCi(env) {
  const ci = env["CI"]
  return (
    (ci !== undefined && ci !== "" && ci !== "false" && ci !== "0") ||
    env["GITHUB_ACTIONS"] === "true"
  )
}

/**
 * @param {{ ci: boolean, inRepo: boolean, configured: string | undefined, bundled: string, realpath: (p: string) => string }} input
 *   `configured` is `core.hooksPath` as git reports it; `bundled` is the hooks directory shipped here.
 * @returns {"ci" | "not-a-repo" | "installed" | "missing"}
 */
export function hooksStatus({ ci, inRepo, configured, bundled, realpath }) {
  if (ci) return "ci"
  if (!inRepo) return "not-a-repo"
  if (configured === undefined || configured === "") return "missing"
  try {
    return realpath(configured) === realpath(bundled) ? "installed" : "missing"
  } catch {
    return "missing"
  }
}
