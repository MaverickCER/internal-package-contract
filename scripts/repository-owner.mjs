// Who owns a repository, read from how a package writes it down: a GitHub URL (https, ssh or git+), the npm
// shorthand `github:owner/name` or `owner/name`, or an object with a `url`. Used by `init`, `doctor` and the
// managed documents, so they agree on the owner of one package.

/**
 * @param {unknown} repository - package.json's `repository` field, or a git remote URL.
 * @returns {string | undefined} the GitHub owner, or `undefined` when it is not written in a form this reads.
 */
export function repositoryOwner(repository) {
  // Anything that is not text reads as "undefined" or "3", which names no owner.
  const url = String(typeof repository === "string" ? repository : repository?.url)
  return (
    /github\.com[/:]([^/]+)\//.exec(url)?.[1] ?? /^(?:github:)?([\w.-]+)\/[\w.-]+$/.exec(url)?.[1]
  )
}
