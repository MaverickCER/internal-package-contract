// What each published figure means, said where the figure is published. A badge is one number and a color; a reader
// who sees "coverage 98.4%" cannot tell which of the four coverage measures it is, or whether it is an average or the
// worst of them. Each badge therefore has a details file beside it with the same number, the statistic it is, every
// value it summarises, and a sentence saying what each of them counts.

/** The four things a coverage report measures, in the order they are shown. */
export const COVERAGE_METRICS = /** @type {const} */ ([
  "lines",
  "statements",
  "functions",
  "branches",
])

/** What each coverage measure counts. */
export const COVERAGE_MEANING = {
  lines: "The share of source lines that ran at least once.",
  statements: "The share of statements that ran at least once (a line can hold several).",
  functions: "The share of functions that were called at least once.",
  branches:
    "The share of decision outcomes that were taken: each side of an if, a ternary, a switch case or a logical operator.",
}

/** What the coverage headline is. */
export const COVERAGE_HEADLINE =
  "The lowest of the four percentages below, not their average, so one weak measure is never hidden by three strong ones."

/** What the mutation score is. */
export const MUTATION_MEANING =
  "The share of applicable mutants the tests detect. A mutant is a small deliberate change to the code; the tests detect it by failing. Killed, runtime-error and compile-error mutants count as detected; ignored mutants are left out; survived, uncovered and timed-out mutants count against the score, a timeout exactly like a survivor."

/** What the size figure is. */
export const SIZE_MEANING =
  "The gzip-compressed size of the entry point's built file, which is what a consumer downloads; the budget is a hard limit the build checks."
