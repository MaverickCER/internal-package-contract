import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createBranchProtection } from "../checks/branch-protection.js"
import { codeScanning } from "../checks/code-scanning.js"
import { commits } from "../checks/commits.js"
import { docsLinks } from "../checks/docs-links.js"
import { ENVIRONMENT_EXCEPTION_SCHEMA } from "../checks/environment-exceptions.js"
import { isExpired, validateExceptionRegistry } from "../checks/exception-record.js"
import { packageRoot } from "../checks/shared.js"
import { COMPLETE_V2, makeContext, makeJsonResult, makeResult } from "./support.js"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-misc-exact-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe("createBranchProtection()", () => {
  it("runs the branch-protection script and reads its JSON", () => {
    const check = createBranchProtection()
    expect(check.run).toEqual([
      "node",
      path.join(packageRoot, "scripts", "check-branch-protection.mjs"),
    ])
    expect(check.output).toEqual({ format: "json" })
  })
})

describe("codeScanning() when the alerts could not be read", () => {
  const failure = async (kind: string | undefined, message?: string) =>
    (
      await codeScanning().policy(
        makeContext(
          makeJsonResult({ ok: false, message, data: kind === undefined ? undefined : { kind } }),
        ),
      )
    ).rationale
  const wrap = (steps: string[]) =>
    [
      "Code scanning could not be reviewed:",
      ...steps.map((step, i) => `  ${String(i + 1)}. ${step}`),
      "Re-run `npm run contract`. This check never passes without reading the alerts.",
    ].join("\n")

  it("tells a run with no token how to give it one", async () => {
    expect(await failure("no-token")).toBe(
      wrap([
        "In the contract workflow job add `permissions: { contents: read, security-events: read }`.",
        "Pass the token to the step that runs the contract: `env: { GH_TOKEN: ${{ github.token }} }`.",
      ]),
    )
  })

  it("passes on what GitHub said about a list too long to read, or a stock sentence", async () => {
    expect(await failure("truncated", "There are 3000 alerts.")).toBe(
      wrap(["There are 3000 alerts.", "Triage the open alerts on GitHub first."]),
    )
    expect(await failure("truncated")).toBe(
      wrap([
        "The alert list is too long to read in full.",
        "Triage the open alerts on GitHub first.",
      ]),
    )
    expect(await failure("truncated", "")).toBe(
      wrap(["", "Triage the open alerts on GitHub first."]),
    )
  })

  it("gives the steps for each way the CLI can be unavailable", async () => {
    expect(await failure("gh-not-installed")).toBe(
      wrap([
        "Install the GitHub CLI: https://cli.github.com (macOS: `brew install gh`).",
        "Sign in: `gh auth login`.",
        "Allow it to read code scanning: `gh auth refresh -s security_events`.",
      ]),
    )
    expect(await failure("not-authenticated")).toBe(
      wrap([
        "Sign in: `gh auth login`.",
        "Allow it to read code scanning: `gh auth refresh -s security_events`.",
      ]),
    )
    expect(await failure("no-access")).toBe(
      wrap([
        "Your gh login cannot read this repository's code-scanning alerts.",
        "Allow it: `gh auth refresh -s security_events`, and use an account with access to the repository.",
      ]),
    )
  })

  it("says GitHub's answer could not be read for anything else, with its message if any", async () => {
    expect(await failure("other", "boom")).toBe(wrap(["GitHub's answer could not be read: boom"]))
    expect(await failure(undefined, "boom")).toBe(wrap(["GitHub's answer could not be read: boom"]))
    expect(await failure(undefined)).toBe(wrap(["GitHub's answer could not be read."]))
    expect(await failure("other", "")).toBe(wrap(["GitHub's answer could not be read."]))
  })
})

describe("isExpired()", () => {
  const now = new Date("2026-10-02T12:00:00Z")

  it("is true only for a valid date before today", () => {
    expect(isExpired("2026-10-01", now)).toBe(true)
    expect(isExpired("2020-01-01", now)).toBe(true)
    expect(isExpired("2026-10-02", now)).toBe(false)
    expect(isExpired("2026-10-03", now)).toBe(false)
    expect(isExpired("2099-01-01", now)).toBe(false)
  })

  it("is false for an empty or malformed date, which would otherwise compare as text", () => {
    for (const bad of [
      "",
      "2026",
      "2026-10",
      "2026-1-01",
      "2026-10-1",
      "2026-10-01x",
      "x2026-10-01",
      "2026-10-01T00:00:00Z",
      "abc",
      " 2026-10-01",
    ]) {
      expect(isExpired(bad, now), bad).toBe(false)
    }
  })

  it("defaults to the real clock", () => {
    expect(isExpired("2000-01-01")).toBe(true)
    expect(isExpired("2999-01-01")).toBe(false)
  })
})

describe("version 2 record validation", () => {
  const record = (over: Record<string, unknown> = {}) => ({
    id: "environment:X:y",
    version: 2,
    justification: "j",
    check: "X",
    code: "y",
    ...COMPLETE_V2,
    ...over,
  })
  const validate = (value: Record<string, unknown>) =>
    validateExceptionRegistry([value], ENVIRONMENT_EXCEPTION_SCHEMA)

  it("accepts a complete version 2 record, keeping its structured fields", () => {
    const result = validate(record())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("invalid")
    expect(result.records[0]).toMatchObject({
      version: 2,
      check: "X",
      code: "y",
      ruleBroken: COMPLETE_V2.ruleBroken,
    })
  })

  it("names each missing structured field, and nothing but that", () => {
    const result = validate(record({ constraint: undefined, residualRisk: 5 }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("valid")
    expect(result.errors).toEqual([
      "exceptions[0].constraint must be a string (a version 2 record carries it).",
      "exceptions[0].residualRisk must be a string (a version 2 record carries it).",
    ])
  })

  it("does not go on to judge the registry's own fields while a structured one is wrong", () => {
    const result = validate(record({ constraint: undefined, check: "" }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("valid")
    expect(result.errors).toEqual([
      "exceptions[0].constraint must be a string (a version 2 record carries it).",
    ])
  })

  it("needs expires to be an empty string or an ISO date, quoting what it got", () => {
    for (const [bad, shown] of [
      [undefined, "undefined"],
      [5, "5"],
      ["soon", '"soon"'],
      ["2026-1-1", '"2026-1-1"'],
    ] as const) {
      const result = validate(record({ expires: bad }))
      expect(result.ok, String(bad)).toBe(false)
      if (result.ok) throw new Error("valid")
      expect(result.errors).toEqual([
        `exceptions[0].expires must be "" or a YYYY-MM-DD date (got ${shown}).`,
      ])
    }
    const asArray = validate(record({ expires: ["2030-01-01"] }))
    expect(asArray.ok).toBe(false)
    const withBadField = validate(record({ expires: "soon", check: "" }))
    expect(withBadField.ok).toBe(false)
    if (withBadField.ok) throw new Error("valid")
    expect(withBadField.errors).toEqual([
      'exceptions[0].expires must be "" or a YYYY-MM-DD date (got "soon").',
    ])
    expect(validate(record({ expires: "" })).ok).toBe(true)
    expect(validate(record({ expires: "2030-01-01" })).ok).toBe(true)
  })
})

describe("commits() with no base to lint against", () => {
  it("records it as a degradation that a record under environment:Commits:no-base accepts", async () => {
    const result = await commits().policy(
      makeContext(makeResult({ exitCode: 1, stderr: "fatal: bad revision 'origin/main..HEAD'" })),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("environment:Commits:no-base (no record)")
    expect(result.rationale).toContain(
      "Commits: could not resolve `origin/main..HEAD` -- nothing to lint",
    )
    expect(result.rationale).toContain("Fetch `origin/main` in CI to enable this check.")
  })
})

describe("docsLinks() with unreachable external links", () => {
  it("lists every distinct URL once, comma separated, with their number", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    mkdirSync(path.join(cwd, "docs"), { recursive: true })
    const links = [
      { url: "https://a.example/x", state: "BROKEN", status: 404 },
      { url: "https://b.example/y", state: "BROKEN", status: 500 },
      { url: "https://a.example/x", state: "BROKEN", status: 404 },
    ]
    const result = await docsLinks.policy(
      makeContext(makeJsonResult({ ok: true, value: { links } })),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain(
      "Docs (links): 0 broken local link(s) across 3 checked (2 external link(s) unreachable: https://a.example/x, https://b.example/y).",
    )
    expect(result.rationale).toContain("environment:DocsLinks:https://a.example/x")
  })
})
