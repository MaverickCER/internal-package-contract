// Declares a benchmark suite and REFUSES to accept one that is not documented. A benchmark nobody can
// interpret is noise, so the documentation is part of the definition: why the function is measured,
// what poor performance would mean, its expected big-O and the reason for it, and every variable that
// could change its cost. `defineSuite` collects every gap and throws once, listing all of them.

import { STANDARD_TIERS, validateTiers } from "./tiers.mjs"

/** The complexity classes the kit can recognize, with their notation. Matches classify-complexity.mjs. */
export const COMPLEXITY_NOTATION = Object.freeze({
  constant: "O(1)",
  logarithmic: "O(log n)",
  linear: "O(n)",
  linearithmic: "O(n log n)",
  quadratic: "O(n²)",
  "cubic-or-worse": "O(n³) or worse",
})

/** Thrown by {@link defineSuite} with every documentation/shape problem found. */
/**
 * The growth class and reason that apply to one measured group: the variant's own when it declares
 * one, otherwise the function's.
 * @param {object} fn - a function entry.
 * @param {object | undefined} variant - one of its variants, if measured as one.
 * @returns {{ expectedComplexity: string, complexityReason: string }} the expectation.
 */
export function expectationOf(fn, variant) {
  return variant?.expectedComplexity === undefined
    ? { expectedComplexity: fn.expectedComplexity, complexityReason: fn.complexityReason }
    : { expectedComplexity: variant.expectedComplexity, complexityReason: variant.complexityReason }
}

export class SuiteDefinitionError extends Error {
  /** @param {readonly string[]} problems - every problem found. */
  constructor(problems) {
    super(
      `The benchmark suite is not valid:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    )
    this.name = "SuiteDefinitionError"
    this.problems = problems
  }
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * @param {unknown} value - a candidate identifier.
 * @returns {boolean} whether it is a kebab-case string (a number or an object never is).
 */
const isKebab = (value) => typeof value === "string" && KEBAB.test(value)

/**
 * Reads `key` off `value`, tolerating a missing value -- a definition under validation may be
 * anything, and every gap in it must be reported, not crash the validator.
 * @param {any} value - what to read from.
 * @param {string} key - the property to read.
 * @returns {any} the property, or `undefined`.
 */
const get = (value, key) => value?.[key]

function text(value, at, problems, minLength = 20) {
  if (typeof value !== "string" || value.trim().length < minLength) {
    problems.push(
      `${at} must be a real explanation (at least ${String(minLength)} characters), not a placeholder.`,
    )
  }
}

function validateVariables(variables, at, problems) {
  if (!Array.isArray(variables) || variables.length === 0) {
    problems.push(
      `${at}.variables must list every variable that could change this benchmark's cost (input size, payload shape, cache state, concurrency...), each marked "swept", "variant" or "fixed".`,
    )
    return
  }
  variables.forEach((variable, index) => {
    const here = `${at}.variables[${String(index)}]`
    const name = get(variable, "name")
    if (typeof name !== "string" || name.trim() === "") problems.push(`${here}.name is required.`)
    text(get(variable, "description"), `${here}.description`, problems, 10)
    const how = get(variable, "how")
    if (!["swept", "variant", "fixed"].includes(how)) {
      problems.push(
        `${here}.how must be "swept" (the tier axis), "variant" (a measured variant) or "fixed" (held constant on purpose).`,
      )
    }
    if (how === "fixed" && get(variable, "value") === undefined) {
      problems.push(`${here}.value is required for a "fixed" variable -- say what it was held at.`)
    }
  })
}

/** A runnable is EITHER `{ call, input }` (an imported function and the arguments to give it) OR `{ setup?, run }`. */
function validateRunnable(runnable, at, problems) {
  const hasCall = get(runnable, "call") !== undefined
  if (hasCall) {
    if (typeof runnable.call !== "function")
      problems.push(`${at}.call must be the function to benchmark.`)
    if (typeof runnable.input !== "function") {
      problems.push(`${at}.input must be a function of n returning the argument list for call.`)
    }
    if (runnable.run !== undefined || runnable.setup !== undefined) {
      problems.push(`${at} must use either call/input or setup/run, not both.`)
    }
    return
  }
  if (typeof get(runnable, "run") !== "function")
    problems.push(`${at}.run must be a function (or give call and input).`)
  const setup = get(runnable, "setup")
  if (setup !== undefined && typeof setup !== "function")
    problems.push(`${at}.setup must be a function.`)
}

/**
 * Turns the call/input shorthand into setup/run. The function under test is invoked as
 * `call(...input(n, variantOptions))`, so a suite can import real functions and just describe how to
 * build their arguments at size n.
 */
function normalizeRunnable(runnable) {
  if (runnable.call === undefined) return runnable
  const { call, input, ...rest } = runnable
  return { ...rest, setup: (n, options) => input(n, options), run: (args) => call(...args) }
}

function validateBenchmark(benchmark, at, problems, { needsId }) {
  if (needsId && !isKebab(get(benchmark, "id")))
    problems.push(`${at}.id must be kebab-case (letters, digits, "-").`)
  text(get(benchmark, "why"), `${at}.why (why this is benchmarked)`, problems)
  text(
    get(benchmark, "poorPerformanceMeans"),
    `${at}.poorPerformanceMeans (what slow would mean for a user)`,
    problems,
  )
  if (!Object.hasOwn(COMPLEXITY_NOTATION, get(benchmark, "expectedComplexity"))) {
    problems.push(
      `${at}.expectedComplexity must be one of: ${Object.keys(COMPLEXITY_NOTATION).join(", ")}.`,
    )
  }
  text(get(benchmark, "complexityReason"), `${at}.complexityReason (why that big-O)`, problems)
  validateVariables(get(benchmark, "variables"), at, problems)
  validateRunnable(benchmark, at, problems)
  const tiers = get(benchmark, "tiers")
  if (tiers !== undefined) {
    problems.push(...validateTiers(tiers, 4).map((problem) => `${at}.tiers: ${problem}.`))
    text(
      get(benchmark, "tiersReason"),
      `${at}.tiersReason (why this function cannot be measured on the standard ladder)`,
      problems,
    )
  }
  for (const [index, variant] of (get(benchmark, "variants") ?? []).entries()) {
    const here = `${at}.variants[${String(index)}]`
    if (!isKebab(get(variant, "name"))) problems.push(`${here}.name must be kebab-case.`)
    text(get(variant, "description"), `${here}.description`, problems, 10)
    // A variant may follow a different growth curve than the function as a whole (a scoped run that
    // ignores most of the input, say); it then states its own expectation and the mechanism.
    const expected = get(variant, "expectedComplexity")
    if (expected !== undefined) {
      if (!Object.hasOwn(COMPLEXITY_NOTATION, expected)) {
        problems.push(
          `${here}.expectedComplexity must be one of: ${Object.keys(COMPLEXITY_NOTATION).join(", ")}.`,
        )
      }
      text(
        variant.complexityReason,
        `${here}.complexityReason (why this variant differs)`,
        problems,
      )
    }
  }
  for (const [index, excluded] of (get(benchmark, "notCovered") ?? []).entries()) {
    const reason = get(excluded, "reason")
    if (
      typeof get(excluded, "name") !== "string" ||
      typeof reason !== "string" ||
      reason.length < 10
    ) {
      problems.push(`${at}.notCovered[${String(index)}] needs a name and a reason it is excluded.`)
    }
  }
}

/**
 * @param {object} suite - the suite definition (see the scaffolded benchmarks/suite.mjs for the full shape).
 * @returns {object} the same suite, frozen, with defaults applied (`tiers`, `workload.typicalN`).
 * @throws {SuiteDefinitionError} when anything is missing, malformed or undocumented.
 */
export function defineSuite(suite) {
  const problems = []
  const packageName = get(get(suite, "package"), "name")
  if (typeof packageName !== "string" || packageName === "")
    problems.push("package.name is required.")
  const workload = get(suite, "workload")
  text(get(workload, "description"), "workload.description (what one unit of `n` is)", problems, 10)
  const unit = get(workload, "unit")
  if (typeof unit !== "string" || unit === "")
    problems.push('workload.unit is required (e.g. "record").')

  const tiers = get(suite, "tiers") ?? STANDARD_TIERS
  problems.push(...validateTiers(tiers).map((problem) => `tiers: ${problem}.`))
  const typicalN = get(workload, "typicalN") ?? 640
  if (!tiers.includes(typicalN))
    problems.push(`workload.typicalN (${String(typicalN)}) must be one of the tiers.`)

  const endToEnd = get(suite, "endToEnd")
  text(
    get(endToEnd, "purpose"),
    "endToEnd.purpose (what the end-to-end benchmark shows and why it matters)",
    problems,
  )
  text(
    get(get(endToEnd, "baseline"), "description"),
    "endToEnd.baseline.description (the minimal work done WITHOUT the package)",
    problems,
  )
  text(
    get(get(endToEnd, "withPackage"), "description"),
    "endToEnd.withPackage.description (the same work routed THROUGH the package)",
    problems,
  )
  for (const side of ["baseline", "withPackage"]) {
    validateRunnable(get(endToEnd, side), `endToEnd.${side}`, problems)
  }
  validateVariables(get(endToEnd, "variables"), "endToEnd", problems)

  const seen = new Set()
  const functions = get(suite, "functions") ?? []
  if (functions.length === 0)
    problems.push("functions must list at least one benchmarked function.")
  functions.forEach((benchmark, index) => {
    const id = get(benchmark, "id")
    const at = `functions[${String(index)}]${id ? ` (${id})` : ""}`
    validateBenchmark(benchmark, at, problems, { needsId: true })
    if (seen.has(id)) problems.push(`${at}.id is duplicated.`)
    seen.add(id)
    if (get(benchmark, "inEndToEnd") !== undefined) {
      text(
        benchmark.inEndToEnd.description,
        `${at}.inEndToEnd.description (how the end-to-end run calls it)`,
        problems,
        10,
      )
      const calls = benchmark.inEndToEnd.callsPerOperation
      if (typeof calls !== "number" && typeof calls !== "function") {
        problems.push(`${at}.inEndToEnd.callsPerOperation must be a number or a function of n.`)
      }
      // A function measured on its own includes everything it calls. When one benchmarked function
      // calls another that is also attributed, naming it here lets the report subtract the nested time
      // instead of counting it twice.
      const includes = benchmark.inEndToEnd.includes
      if (includes !== undefined) {
        if (!Array.isArray(includes) || includes.some((id) => typeof id !== "string")) {
          problems.push(`${at}.inEndToEnd.includes must be a list of function ids.`)
        } else {
          for (const id of includes) {
            if (id === benchmark.id) problems.push(`${at}.inEndToEnd.includes cannot list itself.`)
            else if (!functions.some((other) => get(other, "id") === id)) {
              problems.push(
                `${at}.inEndToEnd.includes names "${id}", which is not a function in this suite.`,
              )
            }
          }
        }
      }
    }
  })

  if (problems.length > 0) throw new SuiteDefinitionError(problems)

  return Object.freeze({
    ...suite,
    endToEnd: {
      ...suite.endToEnd,
      baseline: normalizeRunnable(suite.endToEnd.baseline),
      withPackage: normalizeRunnable(suite.endToEnd.withPackage),
    },
    functions: functions.map(normalizeRunnable),
    tiers,
    workload: Object.freeze({ ...suite.workload, typicalN }),
  })
}
