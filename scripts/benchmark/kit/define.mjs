// Declares a benchmark suite and REFUSES to accept one that is not documented. A benchmark nobody can
// interpret is noise, so the documentation is part of the definition: why the function is measured,
// what poor performance would mean, its expected big-O and the reason for it, and every variable that
// could change its cost. `defineSuite` collects every gap and throws once, listing all of them.

import { parseAccounting } from "../coverage/accounting.mjs"
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

/**
 * The name of one measured group: `fn:<id>`, then `@<variant>` when it is a variant, then `#<variable>`
 * when it varies a variable other than the suite's own unit.
 * @param {string} id - the function's id.
 * @param {string | undefined} [variant] - the variant's name.
 * @param {string | undefined} [variable] - a swept variable other than the suite's unit.
 * @returns {string} the group name.
 */
export function groupName(id, variant, variable) {
  return `fn:${id}${variant === undefined ? "" : `@${variant}`}${variable === undefined ? "" : `#${variable}`}`
}

/**
 * @param {string} group - a group name as {@link groupName} writes it.
 * @returns {{ id: string, variant?: string, variable?: string } | undefined} its parts, or `undefined` for a group that is not a function's.
 */
export function parseGroup(group) {
  const match = /^fn:([^@#]+)(?:@([^#]+))?(?:#(.+))?$/.exec(group)
  if (match === null) return undefined
  return {
    id: match[1],
    ...(match[2] === undefined ? {} : { variant: match[2] }),
    ...(match[3] === undefined ? {} : { variable: match[3] }),
  }
}

/** Thrown by {@link defineSuite} with every documentation/shape problem found. */
/**
 * The growth class and reason that apply to one measured group: the swept variable's own when it is
 * not the suite's unit, else the variant's own when it declares one, otherwise the function's.
 * @param {object} fn - a function entry.
 * @param {object | undefined} variant - one of its variants, if measured as one.
 * @param {string | undefined} [variable] - the swept variable the group varies, when it is not the unit.
 * @returns {{ expectedComplexity: string, complexityReason: string }} the expectation.
 */
export function expectationOf(fn, variant, variable) {
  const sweep = fn.sweeps?.find((s) => s.variable === variable)
  if (sweep !== undefined) {
    return {
      expectedComplexity: sweep.expectedComplexity,
      complexityReason: sweep.complexityReason,
    }
  }
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
  return {
    ...rest,
    setup: (n, options, context) => input(n, options, context),
    run: (args) => call(...args),
  }
}

/**
 * A function whose cost depends on more than one input declares each one it can sweep. The suite's
 * unit is the first; every other is a `sweeps` entry, measured on its own (the others held at their
 * base values) and given its own growth class, so one big-O never mixes two variables.
 */
function validateSweeps(benchmark, at, unit, problems) {
  const sweeps = get(benchmark, "sweeps")
  if (sweeps === undefined) return
  if (!Array.isArray(sweeps) || sweeps.length === 0) {
    problems.push(`${at}.sweeps must list at least one variable, or be left out.`)
    return
  }
  const seen = new Set()
  sweeps.forEach((sweep, index) => {
    const here = `${at}.sweeps[${String(index)}]`
    const name = get(sweep, "variable")
    if (!isKebab(name)) problems.push(`${here}.variable must be kebab-case.`)
    else if (name === unit) {
      problems.push(`${here}.variable "${name}" is the suite's own unit, which is always swept.`)
    } else if (seen.has(name)) problems.push(`${here}.variable "${name}" is listed twice.`)
    seen.add(name)
    text(get(sweep, "description"), `${here}.description`, problems, 10)
    for (const key of ["baseValue", "primaryValue"]) {
      const value = get(sweep, key)
      if (key === "baseValue" || value !== undefined) {
        if (!Number.isInteger(value) || value <= 0) {
          problems.push(
            `${here}.${key} must be a positive integer${key === "baseValue" ? ": the value held while another variable is swept" : ": the value the unit is held at while this one is swept (default: the typical size)"}.`,
          )
        }
      }
    }
    if (!Object.hasOwn(COMPLEXITY_NOTATION, get(sweep, "expectedComplexity"))) {
      problems.push(
        `${here}.expectedComplexity must be one of: ${Object.keys(COMPLEXITY_NOTATION).join(", ")}.`,
      )
    }
    text(get(sweep, "complexityReason"), `${here}.complexityReason (why that big-O)`, problems)
    const tiers = get(sweep, "tiers")
    if (tiers !== undefined) {
      problems.push(...validateTiers(tiers).map((problem) => `${here}.tiers: ${problem}.`))
    }
    const variables = get(benchmark, "variables")
    const declared =
      Array.isArray(variables) &&
      variables.some(
        (variable) => get(variable, "name") === name && get(variable, "how") === "swept",
      )
    if (!declared) {
      problems.push(
        `${here}.variable "${String(name)}" must also be listed in ${at}.variables as "swept".`,
      )
    }
  })
}

/**
 * What a benchmark says about each parameter (or key) of the public functions it exercises: `covers` maps a
 * function name to a parameter path (`options`, or `options.cache`) to one of the forms in accounting.mjs.
 */
function validateCovers(benchmark, at, problems) {
  const covers = get(benchmark, "covers")
  if (covers === undefined) return
  if (covers === null || typeof covers !== "object" || Array.isArray(covers)) {
    problems.push(`${at}.covers must map each public function it exercises to its parameters.`)
    return
  }
  // Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder string has no variable name, so it matches no sweep.
  const sweeps = (get(benchmark, "sweeps") ?? []).map((sweep) => get(sweep, "variable"))
  // Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder string has no name, so it matches no variant.
  const variants = (get(benchmark, "variants") ?? []).map((variant) => get(variant, "name"))
  for (const [name, parameters] of Object.entries(covers)) {
    const here = `${at}.covers.${name}`
    if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) {
      problems.push(`${here} must map each parameter or key to what the benchmark does with it.`)
      continue
    }
    for (const [path, value] of Object.entries(parameters)) {
      const accounting = parseAccounting(value)
      if (accounting === undefined) {
        problems.push(
          `${here}.${path} must be "swept", "sweep:<variable>", "variant:<name>", "fixed: <why>" or "not covered: <why>" (a reason is at least 10 characters).`,
        )
      } else if (accounting.kind === "sweep" && !sweeps.includes(accounting.name)) {
        problems.push(
          `${here}.${path} names the sweep "${accounting.name}", which ${at} does not declare.`,
        )
      } else if (accounting.kind === "variant" && !variants.includes(accounting.name)) {
        problems.push(
          `${here}.${path} names the variant "${accounting.name}", which ${at} does not declare.`,
        )
      }
    }
  }
}

function validateBenchmark(benchmark, at, problems, { needsId, unit }) {
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
  validateSweeps(benchmark, at, unit, problems)
  validateCovers(benchmark, at, problems)
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

  const notBenchmarked = get(suite, "notBenchmarked")
  if (notBenchmarked !== undefined) {
    if (
      notBenchmarked === null ||
      typeof notBenchmarked !== "object" ||
      Array.isArray(notBenchmarked)
    ) {
      problems.push("notBenchmarked must map each public function it leaves out to the reason.")
    } else {
      for (const [name, reason] of Object.entries(notBenchmarked)) {
        text(reason, `notBenchmarked.${name} (why it has no benchmark)`, problems)
      }
    }
  }

  const seen = new Set()
  const functions = get(suite, "functions") ?? []
  if (functions.length === 0)
    problems.push("functions must list at least one benchmarked function.")
  functions.forEach((benchmark, index) => {
    const id = get(benchmark, "id")
    const at = `functions[${String(index)}]${id ? ` (${id})` : ""}`
    validateBenchmark(benchmark, at, problems, { needsId: true, unit })
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
