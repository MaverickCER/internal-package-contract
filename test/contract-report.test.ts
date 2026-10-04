import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  NOT_EVALUATED_ACCEPTED,
  NOT_EVALUATED_UNEXCEPTED,
  buildReport,
  classifyResult,
  mergeEvidence,
  renderMarkdown,
  writeReportFiles,
} from "../scripts/contract-report.mjs"

describe("classifyResult()", () => {
  it("keeps pass and fail as they are, whatever the rationale says", () => {
    expect(classifyResult({ outcome: "pass", rationale: NOT_EVALUATED_ACCEPTED })).toBe("pass")
    expect(classifyResult({ outcome: "fail", rationale: NOT_EVALUATED_UNEXCEPTED })).toBe("fail")
  })

  it("separates an accepted degradation, an unexcepted one, and a real warning", () => {
    expect(classifyResult({ outcome: "warn", rationale: `${NOT_EVALUATED_ACCEPTED} x): y` })).toBe(
      "not-evaluated",
    )
    expect(
      classifyResult({ outcome: "warn", rationale: `${NOT_EVALUATED_UNEXCEPTED}; add x): y` }),
    ).toBe("unexcepted")
    expect(classifyResult({ outcome: "warn", rationale: "Architecture: 2 warn findings" })).toBe(
      "warn",
    )
  })
})

describe("mergeEvidence()", () => {
  it("merges the checks of every phase and spans their whole time range", () => {
    const merged = mergeEvidence([
      {
        startedAt: "2026-01-01T00:00:10.000Z",
        completedAt: "2026-01-01T00:00:20.000Z",
        checks: { A: 1 },
      },
      {
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:12.000Z",
        checks: { B: 2 },
      },
    ])
    expect(merged).toEqual({
      version: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:20.000Z",
      durationMs: 20_000,
      checks: { A: 1, B: 2 },
    })
  })

  it("is an empty, zero-length document when nothing ran", () => {
    const merged = mergeEvidence([])
    expect(merged.checks).toEqual({})
    expect(merged.durationMs).toBe(0)
  })
})

const results = {
  Lint: { outcome: "pass", rationale: "ok" },
  Docs: { outcome: "warn", rationale: "1 broken external link\nsecond line" },
  Chrome: { outcome: "warn", rationale: `${NOT_EVALUATED_UNEXCEPTED}; add id): no chrome` },
  Review: { outcome: "warn", rationale: `${NOT_EVALUATED_ACCEPTED} id): ci` },
  Tests: { outcome: "fail", rationale: "2 failing\nfoo.test.ts" },
}
const evidenceChecks = { Lint: { durationMs: 1500 }, Tests: { durationMs: 9000 } }
const build = (over: Record<string, unknown> = {}) =>
  buildReport({
    results,
    evidenceChecks,
    skipped: ["SecuritySocket"],
    strict: false,
    generatedAt: "2026-10-02T00:00:00.000Z",
    ...over,
  })

describe("buildReport()", () => {
  it("counts every class and carries each check's class, reason and time", () => {
    const report = build()
    expect(report.counts).toEqual({
      pass: 1,
      warn: 1,
      "not-evaluated": 1,
      unexcepted: 1,
      fail: 1,
      skipped: 1,
    })
    expect(report.checks.find((c) => c.id === "Tests")).toMatchObject({
      outcome: "fail",
      class: "fail",
      durationMs: 9000,
    })
    expect(report.checks.find((c) => c.id === "Chrome")?.durationMs).toBe(0)
    expect(report.checks.at(-1)).toMatchObject({ id: "SecuritySocket", class: "skipped" })
    expect(report.totalDurationMs).toBe(10_500)
  })

  it("fails on a failing check, and on an unexcepted degradation only when strict", () => {
    expect(build().passed).toBe(false)
    const clean = { Chrome: results.Chrome }
    expect(build({ results: clean, strict: false }).passed).toBe(true)
    expect(build({ results: clean, strict: true }).passed).toBe(false)
    expect(build({ results: { Review: results.Review }, strict: true }).passed).toBe(true)
  })
})

describe("renderMarkdown()", () => {
  it("leads with the verdict, groups by class, and shows full reasons for what needs action", () => {
    const md = renderMarkdown(build({ strict: true }), { title: "Contract" })
    expect(md).toContain("## Contract: FAILED (strict)")
    expect(md).toContain("| FAIL | 1 |")
    expect(md).toContain("#### Tests\n\n```text\n2 failing\nfoo.test.ts\n```")
    expect(md).toContain("### NOT EVALUATED, NO EXCEPTION")
    expect(md).toContain("- **Docs** -- 1 broken external link")
    expect(md).not.toContain("second line")
    expect(md).toContain("### Slowest checks")
    expect(md).toContain("| Tests | 9.0s |")
  })

  it("defaults the title, says passed, and omits empty groups and a timing table with no timings", () => {
    const md = renderMarkdown(
      buildReport({
        results: { Lint: { outcome: "pass", rationale: "ok" } },
        evidenceChecks: {},
        skipped: [],
        strict: false,
        generatedAt: "x",
      }),
    )
    expect(md.startsWith("## Contract: passed\n")).toBe(true)
    expect(md).not.toContain("### FAIL")
    expect(md).not.toContain("Slowest checks")
  })
})

describe("writeReportFiles()", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it("writes evidence.json, report.json and summary.md, creating the directory", () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "ipc-report-")), "a", "b")
    dirs.push(path.dirname(path.dirname(dir)))
    const report = build()
    writeReportFiles(dir, { evidence: { version: 1 }, report, markdown: "# md" })
    expect(JSON.parse(readFileSync(path.join(dir, "evidence.json"), "utf8"))).toEqual({
      version: 1,
    })
    expect(JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8"))).toEqual(report)
    expect(readFileSync(path.join(dir, "summary.md"), "utf8")).toBe("# md\n")
  })
})
