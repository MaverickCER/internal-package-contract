import { describe, expect, it } from "vitest"
import { crap, CRAP_THRESHOLD, MAX_COMPLEXITY } from "../checks/crap.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

describe("crap", () => {
  it("fails when crap4ts terminated abnormally, naming crap4ts (not a blank tool name) in the rationale", async () => {
    const result = await crap.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "crap4ts did not run to completion (status: timed_out).",
    })
  })

  it("passes when every function is within budget", async () => {
    const result = await crap.policy(
      makeContext(
        makeJsonResult({
          functions: [{ file: "a.ts", name: "f", startLine: 1, complexity: 2, crap: 2 }],
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale: `CRAP: no function above CRAP ${String(CRAP_THRESHOLD)} or complexity ${String(MAX_COMPLEXITY)} (1 analyzed).`,
    })
  })

  it("fails, listing offenders sorted worst-first, for a CRAP-threshold violation", async () => {
    const result = await crap.policy(
      makeContext(
        makeJsonResult({
          functions: [
            { file: "a.ts", name: "low", startLine: 1, complexity: 2, crap: 31 },
            { file: "a.ts", name: "high", startLine: 5, complexity: 2, crap: 99 },
          ],
        }),
      ),
    )
    expect(result.outcome).toBe("fail")
    const highIdx = result.rationale.indexOf("high")
    const lowIdx = result.rationale.indexOf("low")
    expect(highIdx).toBeGreaterThan(-1)
    expect(highIdx).toBeLessThan(lowIdx)
  })

  it("fails for a raw-complexity ceiling violation even with CRAP within budget, omitting the CRAP section entirely (no CRAP offenders)", async () => {
    const result = await crap.policy(
      makeContext(
        makeJsonResult({
          functions: [{ file: "a.ts", name: "f", startLine: 1, complexity: 21, crap: 1 }],
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Complexity ceiling (20) exceeded by 1 function(s):",
        "- a.ts:1 f — complexity 21",
      ].join("\n"),
    })
  })

  it("fails when a function's crap/complexity score is unreadable (NaN)", async () => {
    const result = await crap.policy(
      makeContext(
        makeJsonResult({
          functions: [{ file: "a.ts", name: "f", startLine: 1, complexity: Number.NaN, crap: 1 }],
        }),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("unreadable CRAP/complexity score")
  })

  it("fails when crap4ts produced invalid JSON report data (no functions array)", async () => {
    const result = await crap.policy(makeContext(makeJsonResult({ notFunctions: [] })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "CRAP: crap4ts produced invalid JSON report data.",
    })
  })

  it("warns instead of failing when Tests already failed, leaving no coverage to weight against", async () => {
    const result = await crap.policy(
      makeContext(makeResult({ exitCode: 1 }), {
        evidence: {
          version: 1,
          startedAt: "",
          completedAt: "",
          durationMs: 0,
          checks: { Tests: makeResult({ exitCode: 1 }) },
        },
      }),
    )
    expect(result).toEqual({
      outcome: "warn",
      rationale:
        "CRAP: not evaluated -- the `Tests` run did not pass, so there is no coverage to weight complexity against (see `Tests`).",
    })
  })

  it("fails, appending printed output, when output could not be parsed as JSON and Tests did not fail", async () => {
    const result = await crap.policy(
      makeContext(
        makeResult({
          output: { format: "json", success: false, error: "bad" },
          stdout: "raw crap4ts output",
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "CRAP: crap4ts output could not be parsed as JSON (no coverage/coverage-final.json?).\nraw crap4ts output",
    })
  })

  it("fails (not warn) when output could not be parsed as JSON but Tests exited 0, with no trailing output", async () => {
    const result = await crap.policy(
      makeContext(makeResult(), {
        evidence: {
          version: 1,
          startedAt: "",
          completedAt: "",
          durationMs: 0,
          checks: { Tests: makeResult({ exitCode: 0 }) },
        },
      }),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "CRAP: crap4ts output could not be parsed as JSON (no coverage/coverage-final.json?).",
    })
  })

  it("fails when the parsed JSON value is null", async () => {
    const result = await crap.policy(makeContext(makeJsonResult(null)))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "CRAP: crap4ts produced invalid JSON report data.",
    })
  })

  it("fails, listing every unreadable function with file:line name, exactly", async () => {
    const result = await crap.policy(
      makeContext(
        makeJsonResult({
          functions: [
            { file: "a.ts", name: "f", startLine: 3, complexity: Number.NaN, crap: 1 },
            {
              file: "b.ts",
              name: "g",
              startLine: 7,
              complexity: 1,
              crap: Number.POSITIVE_INFINITY,
            },
          ],
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "CRAP: 2 function(s) with an unreadable CRAP/complexity score:",
        "- a.ts:3 f",
        "- b.ts:7 g",
      ].join("\n"),
    })
  })

  it("omits the complexity-ceiling section entirely when only CRAP is exceeded", async () => {
    const result = await crap.policy(
      makeContext(
        makeJsonResult({
          functions: [{ file: "a.ts", name: "f", startLine: 1, complexity: 1, crap: 40 }],
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: ["CRAP threshold (30) exceeded by 1 function(s):", "- a.ts:1 f — CRAP 40"].join(
        "\n",
      ),
    })
  })

  it("does not flag a function at exactly the CRAP threshold or exactly the complexity ceiling (both are > , not >=)", async () => {
    const result = await crap.policy(
      makeContext(
        makeJsonResult({
          functions: [
            {
              file: "a.ts",
              name: "f",
              startLine: 1,
              complexity: MAX_COMPLEXITY,
              crap: CRAP_THRESHOLD,
            },
          ],
        }),
      ),
    )
    expect(result.outcome).toBe("pass")
  })

  it("counts only the functions that actually exceed each ceiling, ignoring compliant ones mixed in", async () => {
    const result = await crap.policy(
      makeContext(
        makeJsonResult({
          functions: [
            { file: "a.ts", name: "okCrap", startLine: 1, complexity: 1, crap: 1 },
            { file: "a.ts", name: "okComplexity", startLine: 2, complexity: 1, crap: 1 },
            { file: "a.ts", name: "badCrap", startLine: 3, complexity: 1, crap: 40 },
            { file: "a.ts", name: "badComplexity", startLine: 4, complexity: 25, crap: 1 },
          ],
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "CRAP threshold (30) exceeded by 1 function(s):",
        "- a.ts:3 badCrap — CRAP 40",
        "Complexity ceiling (20) exceeded by 1 function(s):",
        "- a.ts:4 badComplexity — complexity 25",
      ].join("\n"),
    })
  })

  it("sorts multiple complexity offenders worst-first, same as CRAP offenders", async () => {
    const result = await crap.policy(
      makeContext(
        makeJsonResult({
          functions: [
            { file: "a.ts", name: "low", startLine: 1, complexity: 21, crap: 1 },
            { file: "a.ts", name: "high", startLine: 5, complexity: 99, crap: 1 },
          ],
        }),
      ),
    )
    expect(result.outcome).toBe("fail")
    const highIdx = result.rationale.indexOf("high")
    const lowIdx = result.rationale.indexOf("low")
    expect(highIdx).toBeGreaterThan(-1)
    expect(highIdx).toBeLessThan(lowIdx)
  })
})
