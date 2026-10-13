import { describe, expect, it } from "vitest"
import { SuiteDefinitionError, defineSuite } from "../scripts/benchmark/kit/index.mjs"

const LONG = "A sufficiently long and honest explanation."
const swept = { name: "items", how: "swept", description: "The tier axis." }

interface Loose {
  [key: string]: unknown
}

/** A valid suite as plain data, so a test can break one piece of it. */
function suite(overrides: Loose = {}, fn: Loose = {}): Loose {
  return {
    package: { name: "demo" },
    workload: { unit: "item", description: "One item processed per unit of n." },
    endToEnd: {
      purpose: LONG,
      baseline: { description: LONG, setup: (n: number) => n, run: (n: number) => n },
      withPackage: { description: LONG, setup: (n: number) => n, run: (n: number) => n },
      variables: [swept],
    },
    functions: [
      {
        id: "sum",
        why: LONG,
        poorPerformanceMeans: LONG,
        expectedComplexity: "linear",
        complexityReason: LONG,
        variables: [swept],
        inEndToEnd: { callsPerOperation: 1, description: "Called once per operation." },
        setup: (n: number) => n,
        run: (n: number) => n,
        ...fn,
      },
    ],
    ...overrides,
  }
}

function problemsOf(value: unknown): string[] {
  try {
    defineSuite(value as never)
  } catch (error) {
    expect(error).toBeInstanceOf(SuiteDefinitionError)
    return (error as SuiteDefinitionError).problems as string[]
  }
  return []
}

const withEndToEnd = (extra: Loose) =>
  suite({ endToEnd: { ...(suite()["endToEnd"] as Loose), ...extra } })

describe("SuiteDefinitionError", () => {
  it("lists every problem, one per line, and keeps them on the error", () => {
    const error = new SuiteDefinitionError(["first", "second"])
    expect(error.message).toBe("The benchmark suite is not valid:\n- first\n- second")
    expect(error.name).toBe("SuiteDefinitionError")
    expect(error.problems).toEqual(["first", "second"])
    expect(error).toBeInstanceOf(Error)
  })
})

describe("defineSuite() with nothing usable", () => {
  const everything = [
    "package.name is required.",
    "workload.description (what one unit of `n` is) must be a real explanation (at least 10 characters), not a placeholder.",
    'workload.unit is required (e.g. "record").',
    "endToEnd.purpose (what the end-to-end benchmark shows and why it matters) must be a real explanation (at least 20 characters), not a placeholder.",
    "endToEnd.baseline.description (the minimal work done WITHOUT the package) must be a real explanation (at least 20 characters), not a placeholder.",
    "endToEnd.withPackage.description (the same work routed THROUGH the package) must be a real explanation (at least 20 characters), not a placeholder.",
    "endToEnd.baseline.run must be a function (or give call and input).",
    "endToEnd.withPackage.run must be a function (or give call and input).",
    `endToEnd.variables must list every variable that could change this benchmark's cost (input size, payload shape, cache state, concurrency...), each marked "swept", "variant" or "fixed".`,
    "functions must list at least one benchmarked function.",
  ]
  for (const [label, value] of [
    ["undefined", undefined],
    ["null", null],
    ["an empty object", {}],
    ["a number", 3],
  ] as const) {
    it(`reports each requirement when given ${label}`, () => {
      expect(problemsOf(value)).toEqual(everything)
    })
  }
})

describe("the package and workload names", () => {
  it("must be non-empty strings", () => {
    for (const name of ["", undefined, 3, null])
      expect(problemsOf(suite({ package: { name } })), String(name)).toEqual([
        "package.name is required.",
      ])
    for (const unit of ["", undefined, 3, null])
      expect(
        problemsOf(suite({ workload: { unit, description: "One item processed." } })),
        String(unit),
      ).toEqual(['workload.unit is required (e.g. "record").'])
    expect(problemsOf(suite({ package: { name: "x" } }))).toEqual([])
  })
})

describe("defineSuite() on a valid suite", () => {
  it("accepts it, defaulting the tiers and typical size", () => {
    const result = defineSuite(suite() as never) as {
      workload: { typicalN: number }
      tiers: unknown
    }
    expect(result.workload.typicalN).toBe(640)
    expect(problemsOf(suite())).toEqual([])
  })

  it("accepts a typical size that is a tier, and rejects one that is not, naming it", () => {
    expect(
      problemsOf(
        suite({ workload: { unit: "u", description: "One item processed.", typicalN: 640 } }),
      ),
    ).toEqual([])
    expect(
      problemsOf(
        suite({ workload: { unit: "u", description: "One item processed.", typicalN: 7 } }),
      ),
    ).toEqual(["workload.typicalN (7) must be one of the tiers."])
  })

  it("reports a malformed tier list under `tiers:`", () => {
    const problems = problemsOf(suite({ tiers: [10, 10] }))
    expect(problems.length).toBeGreaterThan(0)
    for (const problem of problems.filter((p) => p.startsWith("tiers:")))
      expect(problem.endsWith(".")).toBe(true)
    expect(problems.some((p) => p.startsWith("tiers: "))).toBe(true)
  })
})

describe("documentation text", () => {
  it("accepts text exactly at the minimum, rejects one short, and ignores surrounding whitespace", () => {
    const at = (why: unknown) => problemsOf(suite({}, { why }))
    expect(at("x".repeat(20))).toEqual([])
    expect(at("x".repeat(19))).toEqual([
      "functions[0] (sum).why (why this is benchmarked) must be a real explanation (at least 20 characters), not a placeholder.",
    ])
    expect(at(`  ${"x".repeat(18)}  `)).toHaveLength(1)
    expect(at(20)).toHaveLength(1)
    expect(at(undefined)).toHaveLength(1)
  })

  it("uses a lower minimum where the message says so", () => {
    expect(problemsOf(suite({ workload: { unit: "u", description: "x".repeat(10) } }))).toEqual([])
    expect(problemsOf(suite({ workload: { unit: "u", description: "x".repeat(9) } }))).toHaveLength(
      1,
    )
    expect(
      problemsOf(suite({ workload: { unit: "u", description: `  ${"x".repeat(8)}  ` } })),
    ).toHaveLength(1)
  })
})

describe("variables", () => {
  const vars = (variables: unknown) => problemsOf(suite({}, { variables }))
  const name = "functions[0] (sum).variables"

  it("must be a non-empty list", () => {
    const message = `functions[0] (sum).variables must list every variable that could change this benchmark's cost (input size, payload shape, cache state, concurrency...), each marked "swept", "variant" or "fixed".`
    expect(vars(undefined)).toEqual([message])
    expect(vars([])).toEqual([message])
    expect(vars("items")).toEqual([message])
  })

  it("reports a null entry on every count", () => {
    expect(vars([null])).toEqual([
      `${name}[0].name is required.`,
      `${name}[0].description must be a real explanation (at least 10 characters), not a placeholder.`,
      `${name}[0].how must be "swept" (the tier axis), "variant" (a measured variant) or "fixed" (held constant on purpose).`,
    ])
  })

  it("needs a non-blank string name, a description and a known kind", () => {
    expect(vars([{ ...swept, name: "" }])).toEqual([`${name}[0].name is required.`])
    expect(vars([{ ...swept, name: "   " }])).toEqual([`${name}[0].name is required.`])
    expect(vars([{ ...swept, name: 4 }])).toEqual([`${name}[0].name is required.`])
    expect(vars([{ ...swept, description: "x".repeat(9) }])).toHaveLength(1)
    expect(vars([{ ...swept, description: "x".repeat(10) }])).toEqual([])
    for (const how of ["swept", "variant"]) expect(vars([{ ...swept, how }])).toEqual([])
    expect(vars([{ ...swept, how: "other" }])).toHaveLength(1)
    expect(vars([{ ...swept, how: undefined }])).toHaveLength(1)
  })

  it("needs a value for a fixed variable, whatever falsy value it holds", () => {
    const fixed = { name: "cache", how: "fixed", description: "Held warm on purpose." }
    expect(vars([fixed])).toEqual([
      `${name}[0].value is required for a "fixed" variable -- say what it was held at.`,
    ])
    for (const value of [0, "", false, null])
      expect(vars([{ ...fixed, value }]), String(value)).toEqual([])
    expect(vars([{ ...swept, value: undefined }])).toEqual([])
  })
})

describe("runnables", () => {
  const run = (fn: Loose) => problemsOf(suite({}, fn))
  const at = "functions[0] (sum)"

  it("accepts call/input, and setup/run, alone", () => {
    expect(run({ call: () => 1, input: () => [], setup: undefined, run: undefined })).toEqual([])
    expect(run({})).toEqual([])
    expect(run({ setup: undefined })).toEqual([])
  })

  it("requires a function to run, and a function setup when given", () => {
    expect(run({ run: undefined })).toEqual([
      `${at}.run must be a function (or give call and input).`,
    ])
    expect(run({ run: "x" })).toEqual([`${at}.run must be a function (or give call and input).`])
    expect(run({ setup: "x" })).toEqual([`${at}.setup must be a function.`])
  })

  it("requires call to be a function and input a function of n", () => {
    expect(run({ call: "x", input: () => [], run: undefined, setup: undefined })).toEqual([
      `${at}.call must be the function to benchmark.`,
    ])
    expect(run({ call: () => 1, input: "x", run: undefined, setup: undefined })).toEqual([
      `${at}.input must be a function of n returning the argument list for call.`,
    ])
    expect(run({ call: () => 1, run: undefined, setup: undefined })).toEqual([
      `${at}.input must be a function of n returning the argument list for call.`,
    ])
  })

  it("refuses call/input mixed with setup or run, whichever is given", () => {
    const both = `${at} must use either call/input or setup/run, not both.`
    expect(run({ call: () => 1, input: () => [], run: () => 1, setup: undefined })).toEqual([both])
    expect(run({ call: () => 1, input: () => [], run: undefined, setup: () => 1 })).toEqual([both])
    expect(run({ call: () => 1, input: () => [], run: () => 1, setup: () => 1 })).toEqual([both])
  })

  it("reports a missing end-to-end side without crashing", () => {
    const problems = problemsOf(withEndToEnd({ baseline: null, withPackage: undefined }))
    expect(problems).toEqual([
      "endToEnd.baseline.description (the minimal work done WITHOUT the package) must be a real explanation (at least 20 characters), not a placeholder.",
      "endToEnd.withPackage.description (the same work routed THROUGH the package) must be a real explanation (at least 20 characters), not a placeholder.",
      "endToEnd.baseline.run must be a function (or give call and input).",
      "endToEnd.withPackage.run must be a function (or give call and input).",
    ])
  })

  it("normalises a call/input runnable into setup and run, keeping the rest", () => {
    const calls: unknown[] = []
    const result = defineSuite(
      suite(
        {},
        {
          call: (...args: unknown[]) => {
            calls.push(args)
            return "done"
          },
          input: (n: number, options: unknown) => [n, options],
          run: undefined,
          setup: undefined,
          extra: "kept",
        },
      ) as never,
    ) as unknown as {
      functions: {
        setup: (n: number, o: unknown) => unknown
        run: (a: unknown[]) => unknown
        extra: string
        call?: unknown
        input?: unknown
      }[]
    }
    const [fn] = result.functions
    expect(fn?.extra).toBe("kept")
    expect(fn?.call).toBeUndefined()
    expect(fn?.input).toBeUndefined()
    const args = fn?.setup(5, "opts") as unknown[]
    expect(args).toEqual([5, "opts"])
    expect(fn?.run(args)).toBe("done")
    expect(calls).toEqual([[5, "opts"]])
  })
})

describe("benchmarked functions", () => {
  const fn = (extra: Loose) => problemsOf(suite({}, extra))
  const at = "functions[0] (sum)"

  it("reports a null entry, with its position and no id", () => {
    expect(problemsOf(suite({ functions: [null] }))).toEqual([
      'functions[0].id must be kebab-case (letters, digits, "-").',
      "functions[0].why (why this is benchmarked) must be a real explanation (at least 20 characters), not a placeholder.",
      "functions[0].poorPerformanceMeans (what slow would mean for a user) must be a real explanation (at least 20 characters), not a placeholder.",
      "functions[0].expectedComplexity must be one of: constant, logarithmic, linear, linearithmic, quadratic, cubic-or-worse.",
      "functions[0].complexityReason (why that big-O) must be a real explanation (at least 20 characters), not a placeholder.",
      `functions[0].variables must list every variable that could change this benchmark's cost (input size, payload shape, cache state, concurrency...), each marked "swept", "variant" or "fixed".`,
      "functions[0].run must be a function (or give call and input).",
    ])
  })

  it("needs a kebab-case id, unique across the suite", () => {
    for (const id of ["Sum", "a_b", "-a", "a--b", "", undefined, 3])
      expect(fn({ id }), String(id)).toContain(
        `functions[0]${id ? ` (${String(id)})` : ""}.id must be kebab-case (letters, digits, "-").`,
      )
    for (const id of ["a", "a1", "a-b-c"]) expect(fn({ id })).toEqual([])
    const duplicated = problemsOf(
      suite({
        functions: [(suite()["functions"] as Loose[])[0], (suite()["functions"] as Loose[])[0]],
      }),
    )
    expect(duplicated).toEqual(["functions[1] (sum).id is duplicated."])
  })

  it("needs a known complexity class", () => {
    for (const expectedComplexity of [
      "constant",
      "logarithmic",
      "linear",
      "linearithmic",
      "quadratic",
      "cubic-or-worse",
    ])
      expect(fn({ expectedComplexity })).toEqual([])
    for (const expectedComplexity of ["fast", "", undefined, "toString", "constructor"])
      expect(fn({ expectedComplexity })).toEqual([
        `${at}.expectedComplexity must be one of: constant, logarithmic, linear, linearithmic, quadratic, cubic-or-worse.`,
      ])
  })

  it("validates its own tier ladder and requires the reason for it", () => {
    const withTiers = fn({ tiers: [10, 100, 1000, 10000, 100000] })
    expect(withTiers).toEqual([
      `${at}.tiersReason (why this function cannot be measured on the standard ladder) must be a real explanation (at least 20 characters), not a placeholder.`,
    ])
    expect(fn({ tiers: [10, 100, 1000, 10000, 100000], tiersReason: LONG })).toEqual([])
    const bad = fn({ tiers: [10, 10], tiersReason: LONG })
    expect(bad.length).toBeGreaterThan(0)
    expect(
      bad.every((problem) => problem.startsWith(`${at}.tiers: `) && problem.endsWith(".")),
    ).toBe(true)
  })

  it("reports a null variant, a bad name, a short description and a bad expectation", () => {
    expect(fn({ variants: [null] })).toEqual([
      `${at}.variants[0].name must be kebab-case.`,
      `${at}.variants[0].description must be a real explanation (at least 10 characters), not a placeholder.`,
    ])
    expect(fn({ variants: [{ name: "Bad_Name", description: "x".repeat(10) }] })).toEqual([
      `${at}.variants[0].name must be kebab-case.`,
    ])
    expect(fn({ variants: [{ name: "ok", description: "x".repeat(9) }] })).toHaveLength(1)
    expect(fn({ variants: [{ name: "ok", description: "x".repeat(10) }] })).toEqual([])
    expect(
      fn({
        variants: [
          {
            name: "ok",
            description: "x".repeat(10),
            expectedComplexity: "fast",
            complexityReason: LONG,
          },
        ],
      }),
    ).toEqual([
      `${at}.variants[0].expectedComplexity must be one of: constant, logarithmic, linear, linearithmic, quadratic, cubic-or-worse.`,
    ])
    expect(
      fn({
        variants: [{ name: "ok", description: "x".repeat(10), expectedComplexity: "constant" }],
      }),
    ).toEqual([
      `${at}.variants[0].complexityReason (why this variant differs) must be a real explanation (at least 20 characters), not a placeholder.`,
    ])
    expect(
      fn({
        variants: [
          {
            name: "ok",
            description: "x".repeat(10),
            expectedComplexity: "constant",
            complexityReason: LONG,
          },
        ],
      }),
    ).toEqual([])
  })

  it("requires each excluded case to have a name and a reason of at least ten characters", () => {
    const message = `${at}.notCovered[0] needs a name and a reason it is excluded.`
    expect(fn({ notCovered: [null] })).toEqual([message])
    expect(fn({ notCovered: [{ name: "x" }] })).toEqual([message])
    expect(fn({ notCovered: [{ reason: "x".repeat(10) }] })).toEqual([message])
    expect(fn({ notCovered: [{ name: "x", reason: "x".repeat(9) }] })).toEqual([message])
    expect(fn({ notCovered: [{ name: 3, reason: "x".repeat(10) }] })).toEqual([message])
    expect(fn({ notCovered: [{ name: "x", reason: 10 }] })).toEqual([message])
    expect(fn({ notCovered: [{ name: "x", reason: "x".repeat(10) }] })).toEqual([])
    expect(fn({ notCovered: [{ name: "x", reason: "x".repeat(10) }, null] })).toEqual([
      `${at}.notCovered[1] needs a name and a reason it is excluded.`,
    ])
  })
})

describe("how a function is called in the end-to-end run", () => {
  const e2e = (inEndToEnd: unknown, extra: Loose[] = []) =>
    problemsOf(
      suite({ functions: [{ ...(suite()["functions"] as Loose[])[0], inEndToEnd }, ...extra] }),
    )
  const at = "functions[0] (sum).inEndToEnd"

  it("is optional, needs a description, and calls per operation as a number or a function", () => {
    expect(problemsOf(suite({}, { inEndToEnd: undefined }))).toEqual([])
    expect(e2e({ callsPerOperation: 2, description: "x".repeat(10) })).toEqual([])
    expect(e2e({ callsPerOperation: () => 2, description: "x".repeat(10) })).toEqual([])
    expect(e2e({ callsPerOperation: 2, description: "x".repeat(9) })).toEqual([
      `${at}.description (how the end-to-end run calls it) must be a real explanation (at least 10 characters), not a placeholder.`,
    ])
    for (const callsPerOperation of ["2", undefined, null, {}])
      expect(e2e({ callsPerOperation, description: "x".repeat(10) })).toEqual([
        `${at}.callsPerOperation must be a number or a function of n.`,
      ])
  })

  it("accepts only a list of function ids that exist and are not itself", () => {
    const base = { callsPerOperation: 1, description: "x".repeat(10) }
    const other = { ...(suite()["functions"] as Loose[])[0], id: "other" }
    expect(e2e({ ...base, includes: ["other"] }, [other])).toEqual([])
    expect(e2e({ ...base, includes: [] })).toEqual([])
    const notList = `${at}.includes must be a list of function ids.`
    expect(e2e({ ...base, includes: "other" }, [other])).toEqual([notList])
    expect(e2e({ ...base, includes: [3] }, [other])).toEqual([notList])
    expect(e2e({ ...base, includes: ["other", 3] }, [other])).toEqual([notList])
    expect(e2e({ ...base, includes: [3, "other"] }, [other])).toEqual([notList])
    expect(e2e({ ...base, includes: ["sum"] })).toEqual([`${at}.includes cannot list itself.`])
    expect(e2e({ ...base, includes: ["ghost", "other"] }, [other])).toEqual([
      `${at}.includes names "ghost", which is not a function in this suite.`,
    ])
  })
})

describe("a function that depends on more than one variable", () => {
  const at = "functions[0] (sum).sweeps[0]"
  const vars = [
    swept,
    { name: "width", how: "swept", description: "How wide each item is." },
    { name: "depth", how: "swept", description: "How deep each item nests." },
  ]
  const sweep = (extra: Loose = {}): Loose => ({
    variable: "width",
    description: "How wide each item is.",
    baseValue: 4,
    expectedComplexity: "linear",
    complexityReason: LONG,
    ...extra,
  })
  const problems = (sweeps: unknown, variables: unknown[] = vars) =>
    problemsOf(suite({}, { variables, sweeps }))

  it("accepts a documented sweep of another variable, in every field it may carry", () => {
    expect(
      problems([sweep(), sweep({ variable: "depth", primaryValue: 10, tiers: [5, 10, 15, 20] })]),
    ).toEqual([])
    expect(problems(undefined)).toEqual([])
  })
  it("passes the sweeps through to the frozen suite", () => {
    const defined = defineSuite(
      suite({}, { variables: vars, sweeps: [sweep()] }) as never,
    ) as unknown as { functions: { sweeps: unknown[] }[] }
    expect(defined.functions[0]?.sweeps).toHaveLength(1)
  })
  it("needs a list with something in it", () => {
    for (const sweeps of [[], "width", {}, null]) {
      expect(problems(sweeps), JSON.stringify(sweeps)).toEqual([
        "functions[0] (sum).sweeps must list at least one variable, or be left out.",
      ])
    }
  })
  it("needs a kebab-case name that is neither the suite's unit nor already listed", () => {
    expect(problems([sweep({ variable: "Width" })])).toContain(`${at}.variable must be kebab-case.`)
    expect(problems([sweep({ variable: undefined })])).toContain(
      `${at}.variable must be kebab-case.`,
    )
    expect(problems([sweep({ variable: "item" })])).toContain(
      `${at}.variable "item" is the suite's own unit, which is always swept.`,
    )
    expect(problems([sweep(), sweep()])).toContain(
      'functions[0] (sum).sweeps[1].variable "width" is listed twice.',
    )
  })
  it("needs a description, a base value, a growth class and the reason for it", () => {
    expect(problems([sweep({ description: "short" })])).toEqual([
      `${at}.description must be a real explanation (at least 10 characters), not a placeholder.`,
    ])
    for (const baseValue of [0, -1, 1.5, "4", undefined]) {
      expect(problems([sweep({ baseValue })]), String(baseValue)).toEqual([
        `${at}.baseValue must be a positive integer: the value held while another variable is swept.`,
      ])
    }
    expect(problems([sweep({ primaryValue: 0 })])).toEqual([
      `${at}.primaryValue must be a positive integer: the value the unit is held at while this one is swept (default: the typical size).`,
    ])
    expect(problems([sweep({ expectedComplexity: "fast" })])).toEqual([
      `${at}.expectedComplexity must be one of: constant, logarithmic, linear, linearithmic, quadratic, cubic-or-worse.`,
    ])
    expect(problems([sweep({ complexityReason: "x" })])).toEqual([
      `${at}.complexityReason (why that big-O) must be a real explanation (at least 20 characters), not a placeholder.`,
    ])
  })
  it("checks a ladder of its own like any other", () => {
    expect(problems([sweep({ tiers: [1, 2] })])).toEqual([
      `${at}.tiers: tiers must list at least 4 sizes, or the growth rate (big-O) cannot be estimated.`,
    ])
  })
  it("must also be listed among the function's variables as swept", () => {
    expect(problems([sweep()], [swept])).toEqual([
      `${at}.variable "width" must also be listed in functions[0] (sum).variables as "swept".`,
    ])
    expect(
      problems(
        [sweep()],
        [swept, { name: "width", how: "fixed", value: 4, description: "How wide it is." }],
      ),
    ).toEqual([
      `${at}.variable "width" must also be listed in functions[0] (sum).variables as "swept".`,
    ])
  })
  it("asks for the variables list when it is missing altogether", () => {
    expect(problems([sweep()], null as never)).toContain(
      `${at}.variable "width" must also be listed in functions[0] (sum).variables as "swept".`,
    )
  })
  it("tolerates a null entry, reporting each gap in it", () => {
    expect(problems([null])).toContain(`${at}.variable must be kebab-case.`)
  })
})

describe("covers and notBenchmarked", () => {
  const at = "functions[0] (sum).covers"
  const withCovers = (covers: unknown, fnExtra: Loose = {}) =>
    problemsOf(suite({}, { covers, ...fnExtra }))
  const sweeps = [
    {
      variable: "width",
      description: "How wide each item is.",
      baseValue: 4,
      expectedComplexity: "linear",
      complexityReason: LONG,
    },
  ]
  const vars = [swept, { name: "width", how: "swept", description: "How wide each item is." }]

  it("accepts every form of accounting, for each parameter or key", () => {
    expect(
      withCovers(
        {
          load: {
            schema: "swept",
            "options.width": "sweep:width",
            "options.mode": "variant:cold",
            "options.cache": "fixed: reset before every sample",
            "options.strict": "not covered: only changes the message",
          },
        },
        { variables: vars, sweeps, variants: [{ name: "cold", description: "A cold start." }] },
      ),
    ).toEqual([])
    expect(withCovers(undefined)).toEqual([])
  })
  it("needs a map of functions to parameters", () => {
    for (const covers of [[], "x", null, 3]) {
      expect(withCovers(covers), JSON.stringify(covers)).toEqual([
        "functions[0] (sum).covers must map each public function it exercises to its parameters.",
      ])
    }
    for (const parameters of [[], "x", null]) {
      expect(withCovers({ load: parameters }), JSON.stringify(parameters)).toEqual([
        `${at}.load must map each parameter or key to what the benchmark does with it.`,
      ])
    }
  })
  it("rejects an accounting that is not one of the forms, with the forms", () => {
    expect(withCovers({ load: { a: "maybe", b: "fixed: short" } })).toEqual([
      `${at}.load.a must be "swept", "sweep:<variable>", "variant:<name>", "fixed: <why>" or "not covered: <why>" (a reason is at least 10 characters).`,
      `${at}.load.b must be "swept", "sweep:<variable>", "variant:<name>", "fixed: <why>" or "not covered: <why>" (a reason is at least 10 characters).`,
    ])
  })
  it("only lets a sweep or a variant be named when the function declares it", () => {
    expect(withCovers({ load: { a: "sweep:width" } })).toEqual([
      `${at}.load.a names the sweep "width", which functions[0] (sum) does not declare.`,
    ])
    expect(withCovers({ load: { a: "variant:cold" } })).toEqual([
      `${at}.load.a names the variant "cold", which functions[0] (sum) does not declare.`,
    ])
    expect(withCovers({ load: { a: "sweep:width" } }, { variables: vars, sweeps })).toEqual([])
  })
  it("needs a real reason for each function left out", () => {
    expect(problemsOf(suite({ notBenchmarked: { load: "because" } }))).toEqual([
      "notBenchmarked.load (why it has no benchmark) must be a real explanation (at least 20 characters), not a placeholder.",
    ])
    expect(problemsOf(suite({ notBenchmarked: { load: LONG } }))).toEqual([])
    for (const value of [[], "x", null]) {
      expect(problemsOf(suite({ notBenchmarked: value })), JSON.stringify(value)).toEqual([
        "notBenchmarked must map each public function it leaves out to the reason.",
      ])
    }
  })
})
