import path from "node:path"
import { describe, expect, it } from "vitest"
import { benchmarkGuides } from "../checks/benchmark-guides.js"
import { devOnlyFindings, securityDevDeps } from "../checks/security-dev-deps.js"
import { packageRoot } from "../checks/shared.js"
import { makeContext, makeJsonParseFailure, makeJsonResult, makeResult } from "./support.js"

describe("devOnlyFindings()", () => {
  const vulns = (entries: Record<string, { severity?: unknown; range?: unknown }>) =>
    ({ vulnerabilities: entries }) as never

  it("lists what is in the whole tree and not in the shipped one", () => {
    expect(
      devOnlyFindings(
        vulns({
          a: { severity: "high", range: "<1" },
          b: { severity: "low", range: "<2" },
          c: { severity: "critical", range: "*" },
        }),
        vulns({ b: { severity: "low", range: "<2" } }),
      ),
    ).toEqual([
      { name: "c", severity: "critical", range: "*" },
      { name: "a", severity: "high", range: "<1" },
    ])
  })

  it("orders by severity, most severe first, then by name", () => {
    const names = (all: Record<string, { severity?: unknown }>) =>
      devOnlyFindings(vulns(all), {}).map((f) => f.name)
    expect(
      names({
        e: { severity: "info" },
        d: { severity: "low" },
        c: { severity: "moderate" },
        b: { severity: "high" },
        a: { severity: "critical" },
      }),
    ).toEqual(["a", "b", "c", "d", "e"])
    expect(
      names({ z: { severity: "high" }, m: { severity: "high" }, a: { severity: "high" } }),
    ).toEqual(["a", "m", "z"])
    expect(
      names({ a: { severity: "weird" }, z: { severity: "info" }, b: { severity: "low" } }),
    ).toEqual(["b", "z", "a"])
    expect(
      names({
        a: { severity: "weird" },
        z: { severity: "critical" },
        y: { severity: "high" },
        x: { severity: "moderate" },
      }),
    ).toEqual(["z", "y", "x", "a"])
    expect(
      names({ b: { severity: "low" }, a: { severity: "low" }, c: { severity: "critical" } }),
    ).toEqual(["c", "a", "b"])
  })

  it("puts an unknown or unrecognised severity after every known one, naming it unknown when it is not a string", () => {
    const found = devOnlyFindings(
      vulns({
        n: { severity: "weird" },
        u: {},
        i: { severity: "info" },
        k: { severity: 5 },
        a: { severity: "critical" },
      }),
      {},
    )
    expect(found.map((f) => f.name)).toEqual(["a", "i", "k", "n", "u"])
    expect(found.map((f) => f.severity)).toEqual([
      "critical",
      "info",
      "unknown",
      "weird",
      "unknown",
    ])
    expect(
      devOnlyFindings(
        vulns({ a: { severity: "high", range: 3 }, b: { severity: "high" } }),
        {},
      ).map((f) => f.range),
    ).toEqual(["unknown", "unknown"])
  })

  it("is empty when either report has nothing", () => {
    expect(devOnlyFindings({}, {})).toEqual([])
    expect(devOnlyFindings({}, vulns({ a: {} }))).toEqual([])
    expect(devOnlyFindings(vulns({ a: { severity: "low", range: "x" } }), {})).toEqual([
      { name: "a", severity: "low", range: "x" },
    ])
  })
})

describe("securityDevDeps()", () => {
  const policy = (result: ReturnType<typeof makeResult>) =>
    securityDevDeps().policy(makeContext(result))
  const report = (
    all: Record<string, { severity: string; range: string }>,
    production: Record<string, unknown> = {},
  ) =>
    makeJsonResult({
      ok: true,
      all: { vulnerabilities: all },
      production: { vulnerabilities: production },
    })

  it("runs the audit script and reads its JSON", () => {
    const check = securityDevDeps()
    expect(check.run).toEqual(["node", path.join(packageRoot, "scripts", "audit-dev-deps.mjs")])
    expect(check.output).toEqual({ format: "json" })
  })

  it("fails when the audit did not run to completion", async () => {
    expect(await policy(makeResult({ status: "timed_out" }))).toEqual({
      outcome: "fail",
      rationale: "npm audit did not run to completion (status: timed_out).",
    })
    expect(
      await policy(
        makeResult({ status: "spawn_error", spawnError: "gone", spawnErrorCode: "ENOENT" }),
      ),
    ).toEqual({
      outcome: "fail",
      rationale: "npm audit could not be spawned (ENOENT): gone. Is it installed?",
    })
  })

  it("fails when its output is not the envelope, or says it failed", async () => {
    expect(await policy(makeJsonParseFailure("bad", { stdout: "text" }))).toEqual({
      outcome: "fail",
      rationale: "Dev dependency audit: output could not be parsed as JSON.\ntext",
    })
    expect(await policy(makeJsonResult({ ok: false, error: "registry down" }))).toEqual({
      outcome: "fail",
      rationale: "Dev dependency audit: registry down",
    })
  })

  it("passes when nothing is reachable only through development dependencies", async () => {
    expect(await policy(report({ a: { severity: "high", range: "<1" } }, { a: {} }))).toEqual({
      outcome: "pass",
      rationale:
        "Dev dependency audit: no advisory is reachable only through development dependencies.",
    })
    expect(await policy(report({}))).toMatchObject({ outcome: "pass" })
  })

  it("warns, listing each advisory, when none is critical", async () => {
    expect(
      await policy(
        report({ a: { severity: "high", range: "<1" }, b: { severity: "low", range: "<2" } }),
      ),
    ).toEqual({
      outcome: "warn",
      rationale: [
        "Dev dependency audit: 2 advisory(ies) reachable only through development dependencies (none critical):",
        "- a [high] <1",
        "- b [low] <2",
      ].join("\n"),
    })
  })

  it("lists at most fifteen, and says how many more", async () => {
    const many = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `p${String(i).padStart(2, "0")}`,
          { severity: "low", range: "*" },
        ]),
      )
    const exactly = await policy(report(many(15)))
    expect(exactly.rationale?.split("\n")).toHaveLength(16)
    expect(exactly.rationale).not.toContain("more.")
    const over = await policy(report(many(16)))
    expect(over.rationale?.split("\n")).toHaveLength(17)
    expect(over.rationale?.split("\n").at(-1)).toBe("...and 1 more.")
    expect((await policy(report(many(20)))).rationale?.split("\n").at(-1)).toBe("...and 5 more.")
    expect((await policy(report(many(20)))).rationale).not.toContain("p15")
  })

  it("fails on a critical advisory, naming it and counting the lower ones", async () => {
    const onlyCritical = await policy(
      report({ a: { severity: "critical", range: "*" }, b: { severity: "critical", range: "<3" } }),
    )
    expect(onlyCritical).toEqual({
      outcome: "fail",
      rationale: [
        "Dev dependency audit: 2 critical advisory(ies) in development tooling that runs in CI -- update the dependency or pin a fixed version with an `overrides` entry:",
        "- a [critical] *",
        "- b [critical] <3",
      ].join("\n"),
    })
    const mixed = await policy(
      report({
        a: { severity: "critical", range: "*" },
        b: { severity: "high", range: "<1" },
        c: { severity: "low", range: "<2" },
      }),
    )
    expect(mixed.outcome).toBe("fail")
    expect(mixed.rationale?.split("\n")).toEqual([
      "Dev dependency audit: 1 critical advisory(ies) in development tooling that runs in CI -- update the dependency or pin a fixed version with an `overrides` entry:",
      "- a [critical] *",
      "Plus 2 lower-severity advisory(ies).",
    ])
  })
})

describe("benchmarkGuides()", () => {
  const policy = (value: unknown) => benchmarkGuides().policy(makeContext(makeJsonResult(value)))

  it("runs the guides script in check mode and reads its JSON", () => {
    const check = benchmarkGuides()
    expect(check.run).toEqual([
      "node",
      path.join(packageRoot, "scripts", "benchmark-guides.mjs"),
      "--check",
    ])
    expect(check.output).toEqual({ format: "json" })
  })

  it("passes when there is no benchmarks folder, or both copies match", async () => {
    expect(await policy({ ok: true, applicable: false, missing: [], differing: [] })).toEqual({
      outcome: "pass",
      rationale: "Benchmark guides: no benchmarks/ directory.",
    })
    expect(await policy({ ok: true, applicable: true, missing: [], differing: [] })).toEqual({
      outcome: "pass",
      rationale: "Benchmark guides: both copies are identical to the canonical ones.",
    })
  })

  it("fails naming each guide that is missing or differs, and how to fix it", async () => {
    const lines = (missing: string[], differing: string[]) =>
      policy({ ok: true, applicable: true, missing, differing })
    expect(await lines(["A.md"], ["B.md"])).toEqual({
      outcome: "fail",
      rationale: [
        "Benchmark guides: the copies in benchmarks/ differ from the canonical ones this package ships.",
        "- A.md is missing",
        "- B.md differs",
        "Run `npx internal-package-contract sync-benchmark-guides` and commit the result.",
      ].join("\n"),
    })
    expect((await lines(["A.md"], [])).outcome).toBe("fail")
    expect((await lines([], ["B.md"])).outcome).toBe("fail")
  })

  it("fails when the script's output is unusable", async () => {
    expect(
      await benchmarkGuides().policy(makeContext(makeJsonParseFailure("bad", { stdout: "x" }))),
    ).toEqual({
      outcome: "fail",
      rationale: "Benchmark guides: output could not be parsed as JSON.\nx",
    })
    expect(
      await benchmarkGuides().policy(makeContext(makeResult({ status: "timed_out" }))),
    ).toEqual({
      outcome: "fail",
      rationale: "node did not run to completion (status: timed_out).",
    })
  })
})
