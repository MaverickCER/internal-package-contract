// The arguments `check-docs-links.mjs` gives linkinator, kept apart so a test owns them. The crawl is the
// caller's; the rest lowers concurrency, retries errors with jitter, sets a timeout and asks for JSON.
// Without them a document with many github.com links is rate limited into "not evaluated": linkinator's
// default concurrency is high, and it retries only a 429 that carries a `retry-after` header.

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
