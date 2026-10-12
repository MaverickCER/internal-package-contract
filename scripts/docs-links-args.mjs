// The arguments `check-docs-links.mjs` gives linkinator. Kept apart so they are tested: the crawl is the
// caller's, and the rest is what keeps a document with many github.com links from being rate limited
// into "not evaluated" -- linkinator's default is 100 concurrent requests and it retries only a 429 that
// carries a `retry-after` header.

/**
 * @param {readonly string[]} crawl - what to crawl, e.g. `["README.md", "--recurse", "--markdown"]`.
 * @returns {string[]} the full argument list.
 */
export function linkinatorArgs(crawl) {
  return [
    ...crawl,
    "--concurrency",
    "4",
    "--retry",
    "--retry-errors",
    "--retry-errors-count",
    "3",
    "--retry-errors-jitter",
    "2000",
    "--timeout",
    "30000",
    "--format",
    "json",
  ]
}
