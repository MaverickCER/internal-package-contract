import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import type { ContractReport } from "../scripts/contract-report.mjs"
import {
  NOT_EVALUATED_ACCEPTED,
  NOT_EVALUATED_UNEXCEPTED,
  buildReport,
  mergeEvidence,
  renderMarkdown,
  writeReportFiles,
} from "../scripts/contract-report.mjs"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const SKIPPED_RATIONALE =
  "Not run: it spends scarce quota, so it runs only after every other check passed."

describe("buildReport()", () => {
  const results = {
    Lint: { outcome: "pass", rationale: "ok" },
    Docs: { outcome: "warn", rationale: "a real warning" },
    Links: { outcome: "warn", rationale: `${NOT_EVALUATED_ACCEPTED} x): y` },
    Chrome: { outcome: "warn", rationale: `${NOT_EVALUATED_UNEXCEPTED}; add x): y` },
    Tests: { outcome: "fail", rationale: "broken" },
  }
  const evidenceChecks = {
    Lint: { durationMs: 1000 },
    Docs: { durationMs: 2000 },
    Links: { durationMs: 500 },
    Tests: { durationMs: 250 },
  }
  const build = (extra: Record<string, unknown> = {}) =>
    buildReport({
      results,
      evidenceChecks,
      skipped: ["Socket"],
      strict: false,
      generatedAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    })

  it("lists every check, then the skipped ones, with class, rationale and time", () => {
    const report = build()
    expect(report.checks).toEqual([
      { id: "Lint", outcome: "pass", class: "pass", rationale: "ok", durationMs: 1000 },
      { id: "Docs", outcome: "warn", class: "warn", rationale: "a real warning", durationMs: 2000 },
      {
        id: "Links",
        outcome: "warn",
        class: "not-evaluated",
        rationale: `${NOT_EVALUATED_ACCEPTED} x): y`,
        durationMs: 500,
      },
      {
        id: "Chrome",
        outcome: "warn",
        class: "unexcepted",
        rationale: `${NOT_EVALUATED_UNEXCEPTED}; add x): y`,
        durationMs: 0,
      },
      { id: "Tests", outcome: "fail", class: "fail", rationale: "broken", durationMs: 250 },
      {
        id: "Socket",
        outcome: "skipped",
        class: "skipped",
        rationale: SKIPPED_RATIONALE,
        durationMs: 0,
      },
    ])
    expect(report).toMatchObject({
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      strict: false,
      counts: { pass: 1, warn: 1, "not-evaluated": 1, unexcepted: 1, fail: 1, skipped: 1 },
      totalDurationMs: 3750,
    })
  })

  it("fails on any failed check, and on an unexcepted degradation only when strict", () => {
    expect(build().passed).toBe(false)
    const noFail = { ...results, Tests: { outcome: "pass", rationale: "fixed" } }
    expect(build({ results: noFail }).passed).toBe(true)
    expect(build({ results: noFail, strict: true }).passed).toBe(false)
    const noUnexcepted = { ...noFail, Chrome: { outcome: "pass", rationale: "ok" } }
    expect(build({ results: noUnexcepted, strict: true }).passed).toBe(true)
    expect(build({ results: noUnexcepted, strict: true }).strict).toBe(true)
  })

  it("has no skipped entries unless told of some, and takes zero time for a check with no evidence", () => {
    const report = build({ skipped: [], evidenceChecks: {} })
    expect(report.checks).toHaveLength(5)
    expect(report.counts.skipped).toBe(0)
    expect(report.totalDurationMs).toBe(0)
  })
})

describe("mergeEvidence()", () => {
  it("falls back to the epoch when given nothing, with no checks", () => {
    expect(mergeEvidence([])).toEqual({
      version: 1,
      startedAt: "1970-01-01T00:00:00.000Z",
      completedAt: "1970-01-01T00:00:00.000Z",
      durationMs: 0,
      checks: {},
    })
  })

  it("spans the earliest start to the latest completion, in any order, and merges the checks", () => {
    const merged = mergeEvidence([
      {
        startedAt: "2026-01-01T00:00:30.000Z",
        completedAt: "2026-01-01T00:01:00.000Z",
        checks: { B: 2 },
      },
      {
        startedAt: "2026-01-01T00:00:10.000Z",
        completedAt: "2026-01-01T00:00:20.000Z",
        checks: { A: 1 },
      },
      {
        startedAt: "2026-01-01T00:00:40.000Z",
        completedAt: "2026-01-01T00:00:45.000Z",
        checks: { C: 3 },
      },
    ])
    expect(merged.startedAt).toBe("2026-01-01T00:00:10.000Z")
    expect(merged.completedAt).toBe("2026-01-01T00:01:00.000Z")
    expect(merged.durationMs).toBe(50_000)
    expect(merged.checks).toEqual({ A: 1, B: 2, C: 3 })
  })

  it("never reports a negative duration", () => {
    expect(
      mergeEvidence([
        {
          startedAt: "2026-01-01T00:00:10.000Z",
          completedAt: "2026-01-01T00:00:10.000Z",
          checks: {},
        },
      ]).durationMs,
    ).toBe(0)
  })
})

describe("renderMarkdown()", () => {
  const report = (
    checks: { id: string; klass: string; rationale: string; durationMs?: number }[],
    extra: Record<string, unknown> = {},
  ) => {
    const counts: Record<string, number> = {
      pass: 0,
      warn: 0,
      "not-evaluated": 0,
      unexcepted: 0,
      fail: 0,
      skipped: 0,
    }
    for (const check of checks) counts[check.klass] = (counts[check.klass] ?? 0) + 1
    return {
      version: 1 as const,
      generatedAt: "x",
      strict: false,
      passed: true,
      counts,
      totalDurationMs: checks.reduce((sum, c) => sum + (c.durationMs ?? 0), 0),
      checks: checks.map((c) => ({
        id: c.id,
        outcome: c.klass,
        class: c.klass,
        rationale: c.rationale,
        durationMs: c.durationMs ?? 0,
      })),
      ...extra,
    } as unknown as ContractReport
  }

  it("renders the whole summary: totals, what needs attention in order, exceptions and the slowest checks", () => {
    const markdown = renderMarkdown(
      report(
        [
          { id: "Tests", klass: "fail", rationale: "line one\nline two", durationMs: 4000 },
          { id: "Chrome", klass: "unexcepted", rationale: "no chrome", durationMs: 1500 },
          { id: "Docs", klass: "warn", rationale: "first\nsecond", durationMs: 100 },
          { id: "Links", klass: "not-evaluated", rationale: "offline", durationMs: 0 },
          { id: "Socket", klass: "skipped", rationale: "quota", durationMs: 0 },
          { id: "Lint", klass: "pass", rationale: "ok", durationMs: 2000 },
        ],
        {
          strict: true,
          passed: false,
          exceptions: {
            total: 5,
            legacy: 1,
            expired: 2,
            incomplete: 3,
            registries: [
              { name: "security-deps", total: 3, legacy: 0, expired: 1, incomplete: 2 },
              { name: "socket", total: 2, legacy: 1, expired: 1, incomplete: 1 },
            ],
          },
        },
      ),
      { title: "Repo" },
    )
    expect(markdown).toBe(
      [
        "## Repo: FAILED (strict)",
        "",
        "| Class | Count |",
        "| --- | ---: |",
        "| FAIL | 1 |",
        "| NOT EVALUATED, NO EXCEPTION | 1 |",
        "| WARN | 1 |",
        "| NOT EVALUATED (accepted) | 1 |",
        "| SKIPPED | 1 |",
        "| PASS | 1 |",
        "",
        "### FAIL",
        "",
        "#### Tests",
        "",
        "```text",
        "line one\nline two",
        "```",
        "",
        "",
        "### NOT EVALUATED, NO EXCEPTION",
        "",
        "#### Chrome",
        "",
        "```text",
        "no chrome",
        "```",
        "",
        "",
        "### WARN",
        "",
        "- **Docs** -- first",
        "",
        "### NOT EVALUATED (accepted)",
        "",
        "- **Links** -- offline",
        "",
        "### SKIPPED",
        "",
        "- **Socket** -- quota",
        "",
        "### Exceptions in force",
        "",
        "5 record(s): 1 legacy version 1, 2 expired, 3 incomplete.",
        "",
        "| Registry | Records | Legacy | Expired | Incomplete |",
        "| --- | ---: | ---: | ---: | ---: |",
        "| security-deps | 3 | 0 | 1 | 2 |",
        "| socket | 2 | 1 | 1 | 1 |",
        "",
        "### Slowest checks",
        "",
        "| Check | Time |",
        "| --- | ---: |",
        "| Tests | 4.0s |",
        "| Lint | 2.0s |",
        "| Chrome | 1.5s |",
        "| Docs | 0.1s |",
        "| Links | 0.0s |",
        "",
        "Total check time: 7.6s.",
        "",
      ].join("\n"),
    )
  })

  it("uses the default title and says passed when it did, without a strict marker", () => {
    const markdown = renderMarkdown(report([{ id: "Lint", klass: "pass", rationale: "ok" }]))
    expect(markdown.split("\n")[0]).toBe("## Contract: passed")
    expect(markdown).toBe(
      [
        "## Contract: passed",
        "",
        "| Class | Count |",
        "| --- | ---: |",
        "| FAIL | 0 |",
        "| NOT EVALUATED, NO EXCEPTION | 0 |",
        "| WARN | 0 |",
        "| NOT EVALUATED (accepted) | 0 |",
        "| SKIPPED | 0 |",
        "| PASS | 1 |",
        "",
      ].join("\n"),
    )
  })

  it("cuts a long reason to 2000 characters", () => {
    const markdown = renderMarkdown(
      report([{ id: "Tests", klass: "fail", rationale: `${"a".repeat(2000)}${"b".repeat(500)}` }]),
    )
    expect(markdown).toContain(`\n${"a".repeat(2000)}\n\`\`\``)
    expect(markdown).not.toContain("b")
  })

  it("keeps only the first line of a warning's reason, even an empty one", () => {
    const markdown = renderMarkdown(
      report([
        { id: "A", klass: "warn", rationale: "" },
        { id: "B", klass: "warn", rationale: "\nsecond" },
      ]),
    )
    expect(markdown).toContain("- **A** -- \n- **B** -- \n")
  })

  it("shows the exceptions section only when there are records, and the slowest only when something took time", () => {
    const none = renderMarkdown(
      report([{ id: "Lint", klass: "pass", rationale: "ok" }], {
        exceptions: { total: 0, legacy: 0, expired: 0, incomplete: 0, registries: [] },
      }),
    )
    expect(none).not.toContain("Exceptions in force")
    expect(none).not.toContain("Slowest checks")
    const absent = renderMarkdown(report([{ id: "Lint", klass: "pass", rationale: "ok" }]))
    expect(absent).not.toContain("Exceptions in force")
    const one = renderMarkdown(
      report([{ id: "Lint", klass: "pass", rationale: "ok" }], {
        exceptions: {
          total: 1,
          legacy: 0,
          expired: 0,
          incomplete: 0,
          registries: [{ name: "r", total: 1, legacy: 0, expired: 0, incomplete: 0 }],
        },
      }),
    )
    expect(one).toContain("### Exceptions in force")
    const timed = renderMarkdown(
      report([{ id: "Lint", klass: "pass", rationale: "ok", durationMs: 1 }]),
    )
    expect(timed).toContain("### Slowest checks")
  })

  it("lists only the five slowest, slowest first", () => {
    const checks = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      id: `C${String(n)}`,
      klass: "pass",
      rationale: "ok",
      durationMs: n * 1000,
    }))
    const markdown = renderMarkdown(report(checks))
    const rows = markdown.split("\n").filter((line) => /^\| C\d /.test(line))
    expect(rows).toEqual([
      "| C7 | 7.0s |",
      "| C6 | 6.0s |",
      "| C5 | 5.0s |",
      "| C4 | 4.0s |",
      "| C3 | 3.0s |",
    ])
  })
})

describe("writeReportFiles()", () => {
  it("writes the three files into a directory it creates", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ipc-report-"))
    roots.push(root)
    const dir = path.join(root, "nested", "reports")
    writeReportFiles(dir, { evidence: { a: 1 }, report: { b: 2 } as never, markdown: "# hi" })
    expect(readdirSync(dir).sort()).toEqual(["evidence.json", "report.json", "summary.md"])
    expect(readFileSync(path.join(dir, "evidence.json"), "utf8")).toBe('{\n  "a": 1\n}\n')
    expect(readFileSync(path.join(dir, "report.json"), "utf8")).toBe('{\n  "b": 2\n}\n')
    expect(readFileSync(path.join(dir, "summary.md"), "utf8")).toBe("# hi\n")
    writeReportFiles(dir, { evidence: { a: 3 }, report: { b: 4 } as never, markdown: "# again" })
    expect(readFileSync(path.join(dir, "summary.md"), "utf8")).toBe("# again\n")
  })
})
