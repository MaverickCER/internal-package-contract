import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CODE_SCANNING_SCHEMA,
  codeScanning,
  createDevStub,
  actionEntries,
  deriveCodeScanningId,
  isDevPath,
} from "../checks/code-scanning.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-code-scanning-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

const registryPath = () => path.join(cwd, ".repo-contract/exceptions/code-scanning.json")
const readRegistry = (): { exceptions: Record<string, unknown>[] } =>
  JSON.parse(readFileSync(registryPath(), "utf8"))
function writeRegistry(exceptions: readonly unknown[]): void {
  mkdirSync(path.dirname(registryPath()), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify({ exceptions }), "utf8")
}
const writePackage = (value: unknown) =>
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify(value), "utf8")

const alert = (over: Record<string, unknown> = {}) => ({
  number: 1,
  rule: "js/bad-tag-filter",
  severity: "high",
  path: "test/a.test.ts",
  line: 7,
  tool: "CodeQL",
  message: "A regex that cannot match.",
  ...over,
})
const alerts = (...list: readonly unknown[]) => makeJsonResult({ ok: true, data: { alerts: list } })
const policy = (result: ReturnType<typeof makeResult>) => codeScanning().policy(makeContext(result))

const DEV_TEXT =
  "Development-only code (tests, scripts, docs, CI configuration) is never built, run by users or published, so a finding in it cannot reach anyone."

describe("codeScanning() -- run", () => {
  it("runs the bundled script with node and reads its JSON", () => {
    const run = codeScanning().run as readonly string[]
    expect(run[0]).toBe("node")
    expect(run[1]).toMatch(/scripts[\\/]code-scanning-alerts\.mjs$/)
    expect(codeScanning().output).toEqual({ format: "json" })
  })
})

describe("actionEntries()", () => {
  it("returns the directories of runs.main/pre/post and of every action-path reference", () => {
    expect(
      actionEntries(
        [
          "runs:",
          "  using: node20",
          '  main: "./dist/main.js"',
          "  pre: setup.js # comment",
          "  post: 'dist/post.js'",
          "steps:",
          '  - run: bash "$ACTION_PATH/scripts/github-action/run-cli.sh"',
          "  - run: node ${ACTION_PATH}/tools/a.mjs",
          "  - run: node ${{ github.action_path }}/scripts/github-action/report.mjs",
          "  - run: node ${{github.action_path}}/x/y/z.mjs",
          "  - run: echo $ACTION_PATHS/nope",
        ].join("\n"),
      ),
    ).toEqual(["dist/", "scripts/github-action/", "setup.js", "tools/", "x/y/"])
  })
  it("strips only a leading ./, so a path into the parent directory never names a repository directory", () => {
    expect(actionEntries('  - run: bash "$ACTION_PATH/../shared/run.sh"\n')).toEqual(["../shared/"])
  })
  it("returns nothing for an empty or action-free text", () => {
    expect(actionEntries("")).toEqual([])
    expect(actionEntries("name: x\nruns:\n  using: composite\n")).toEqual([])
  })
})

describe("isDevPath()", () => {
  it("treats every development directory as development-only", () => {
    for (const dir of ["test", "tests", "examples", "benchmarks", "docs", ".github", "scripts"]) {
      expect(isDevPath(`${dir}/x.ts`, [])).toBe(true)
    }
  })
  it("treats test, mock and config files anywhere as development-only", () => {
    for (const file of [
      "src/a.test.ts",
      "src/a.spec.mjs",
      "src/a.test.tsx",
      "src/__tests__/a.ts",
      "src/deep/__mocks__/a.ts",
      "vitest.config.ts",
      "packages/x/tsup.config.mjs",
    ]) {
      expect(isDevPath(file, [])).toBe(true)
    }
  })
  it("treats everything else as code that builds, runs or ships", () => {
    for (const file of [
      "src/index.ts",
      "bin/cli.mjs",
      "index.js",
      "lib/a.ts",
      "tests-helper/a.ts",
    ]) {
      expect(isDevPath(file, [])).toBe(false)
    }
  })
  it("treats a published directory as shipped even when it looks development-only", () => {
    for (const entry of ["scripts", "./scripts", "scripts/", "scripts/**", "scripts/*"]) {
      expect(isDevPath("scripts/run.mjs", [entry])).toBe(false)
    }
    expect(isDevPath("scripts/run.mjs", ["scripts/run.mjs"])).toBe(false)
    expect(isDevPath("scripts/run.mjs", ["scripts-other"])).toBe(true)
    expect(isDevPath("scripts/run.mjs", ["dist"])).toBe(true)
    // Only a LEADING "./" is dropped from an entry, so this one stays a different directory.
    expect(isDevPath("scripts/run.mjs", ["scripts./"])).toBe(true)
  })
})

describe("deriveCodeScanningId() / createDevStub()", () => {
  it("namespaces the id by rule and path", () => {
    expect(deriveCodeScanningId("js/x", "test/a.ts")).toBe("code-scanning:js/x@test/a.ts")
  })
  it("writes a complete, standing record", () => {
    expect(
      createDevStub({ id: "i", rule: "js/x", path: "test/a.ts" }, "code-scanning:js/x@test/a.ts"),
    ).toEqual({
      id: "code-scanning:js/x@test/a.ts",
      version: 2,
      justification: DEV_TEXT,
      alternatives: "Rewrite the flagged code to satisfy the rule.",
      remediation: "None needed while the code stays development-only.",
      // No person reviewed this record: the location rule did, and the record says so.
      method: "policy-rule",
      exceptionType: "dev-only-not-shipped",
      ruleBroken: expect.stringContaining("code-scanning alert must be fixed"),
      attempted: expect.stringContaining("Judged by location"),
      constraint: expect.stringContaining("only exists to test") as unknown,
      whyPreferable: expect.any(String) as unknown,
      residualRisk: expect.stringContaining("None for users"),
      revisitWhen: expect.stringContaining("package.json `files`"),
      expires: "",
      rule: "js/x",
      path: "test/a.ts",
    })
  })
})

describe("CODE_SCANNING_SCHEMA.validateRecord()", () => {
  const core = { id: "code-scanning:js/x@test/a.ts", version: 1, justification: "j" } as never
  const raw = (over: Record<string, unknown> = {}) => ({
    alternatives: "a",
    remediation: "r",
    method: "independent-human-review",
    exceptionType: "dev-only-not-shipped",
    rule: "js/x",
    path: "test/a.ts",
    ...over,
  })
  it("builds the record when valid and the id matches", () => {
    const errors: string[] = []
    expect(CODE_SCANNING_SCHEMA.validateRecord(core, raw(), 0, errors)).toMatchObject({
      id: "code-scanning:js/x@test/a.ts",
      rule: "js/x",
      path: "test/a.ts",
    })
    expect(errors).toEqual([])
  })
  it("rejects a missing rule or path", () => {
    for (const key of ["rule", "path"]) {
      const errors: string[] = []
      expect(
        CODE_SCANNING_SCHEMA.validateRecord(core, raw({ [key]: "" }), 0, errors),
      ).toBeUndefined()
      expect(errors.join()).toContain(`exceptions[0].${key}`)
    }
  })
  it("rejects an id that does not match its own rule and path", () => {
    const errors: string[] = []
    expect(
      CODE_SCANNING_SCHEMA.validateRecord(core, raw({ rule: "js/y" }), 3, errors),
    ).toBeUndefined()
    expect(errors).toEqual([
      'exceptions[3].id "code-scanning:js/x@test/a.ts" does not match the id derived from its own rule and path ("code-scanning:js/y@test/a.ts").',
    ])
  })
  it("accepts only the dev-only exception type", () => {
    const errors: string[] = []
    expect(
      CODE_SCANNING_SCHEMA.validateRecord(core, raw({ exceptionType: "accepted-risk" }), 0, errors),
    ).toBeUndefined()
    expect(errors.join()).toContain('one of "dev-only-not-shipped"')
  })
})

describe("codeScanning() -- policy: could not read", () => {
  const failure = (kind: string | undefined, message?: string) =>
    makeJsonResult({ ok: false, message, data: kind === undefined ? undefined : { kind } })

  it("explains installing and signing in when gh is missing", async () => {
    expect(await policy(failure("gh-not-installed"))).toEqual({
      outcome: "fail",
      rationale: [
        "Code scanning could not be reviewed:",
        "  1. Install the GitHub CLI: https://cli.github.com (macOS: `brew install gh`).",
        "  2. Sign in: `gh auth login`.",
        "  3. Allow it to read code scanning: `gh auth refresh -s security_events`.",
        "Re-run `npm run contract`. This check never passes without reading the alerts.",
      ].join("\n"),
    })
  })
  it("explains signing in when not authenticated", async () => {
    expect((await policy(failure("not-authenticated"))).rationale).toBe(
      [
        "Code scanning could not be reviewed:",
        "  1. Sign in: `gh auth login`.",
        "  2. Allow it to read code scanning: `gh auth refresh -s security_events`.",
        "Re-run `npm run contract`. This check never passes without reading the alerts.",
      ].join("\n"),
    )
  })
  it("explains the missing permission when access is denied", async () => {
    expect((await policy(failure("no-access"))).rationale).toBe(
      [
        "Code scanning could not be reviewed:",
        "  1. Your gh login cannot read this repository's code-scanning alerts.",
        "  2. Allow it: `gh auth refresh -s security_events`, and use an account with access to the repository.",
        "Re-run `npm run contract`. This check never passes without reading the alerts.",
      ].join("\n"),
    )
  })
  it("quotes what GitHub said for anything else, and still never passes", async () => {
    expect((await policy(failure("unreadable", "boom"))).rationale).toContain(
      "  1. GitHub's answer could not be read: boom",
    )
    expect((await policy(failure("unreadable"))).rationale).toContain(
      "  1. GitHub's answer could not be read.",
    )
    expect((await policy(failure(undefined, "x"))).outcome).toBe("fail")
  })
  it("fails closed on abnormal termination and unparseable output", async () => {
    expect((await policy(makeResult({ status: "timed_out" }))).rationale).toBe(
      "code-scanning-alerts did not run to completion (status: timed_out).",
    )
    expect(await policy(makeResult())).toMatchObject({ outcome: "fail" })
    expect((await policy(makeResult())).rationale).toContain(
      "Code scanning: output could not be parsed",
    )
  })
})

describe("codeScanning() -- policy: reviewing alerts", () => {
  it("degrades a skipped review instead of passing it: nothing was reviewed", async () => {
    const result = await policy(
      makeJsonResult({
        ok: true,
        data: { skipped: "code scanning is not enabled for this repository" },
      }),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("Not evaluated (no exception recorded")
    expect(result.rationale).toContain("environment:CodeScanning:not-enabled")
    expect(result.rationale).toContain(
      "Code scanning review skipped: code scanning is not enabled for this repository.",
    )
  })

  it("uses the no-remote code when the repository has no GitHub remote", async () => {
    const result = await policy(
      makeJsonResult({ ok: true, data: { skipped: "no GitHub remote found for pkg" } }),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("environment:CodeScanning:no-remote")
  })

  it("passes with no alerts and leaves an empty registry", async () => {
    expect(await policy(alerts())).toEqual({
      outcome: "pass",
      rationale: "No open code-scanning alerts.",
    })
    expect(readRegistry().exceptions).toEqual([])
  })

  it("treats a report with no data as no alerts", async () => {
    expect((await policy(makeJsonResult({ ok: true }))).outcome).toBe("pass")
  })

  it("leaves OpenSSF Scorecard findings out: they rate repository settings, not code", async () => {
    const result = await policy(
      alerts(
        alert({
          tool: "Scorecard",
          rule: "MaintainedID",
          path: "no file associated with this alert",
        }),
        alert({
          tool: "Scorecard",
          rule: "TokenPermissionsID",
          path: ".github/workflows/release.yml",
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale:
        "No open code-scanning alerts (2 OpenSSF Scorecard finding(s) left out: they rate repository settings and practices, not code).",
    })
    expect(readRegistry().exceptions).toEqual([])
  })

  it("counts only the Scorecard findings it left out when a development-only alert passes beside them", async () => {
    const result = await policy(
      alerts(
        alert({
          tool: "Scorecard",
          rule: "MaintainedID",
          path: "no file associated with this alert",
        }),
        alert({ path: "test/a.test.ts" }),
      ),
    )
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain(
      "1 open code-scanning alert(s), all in development-only code",
    )
    expect(result.rationale).toContain("(1 OpenSSF Scorecard finding(s) left out")
    expect(readRegistry().exceptions.map((record) => record["rule"])).toEqual(["js/bad-tag-filter"])
  })

  it("still fails a code-analysis alert in shipped code when Scorecard findings sit beside it", async () => {
    const result = await policy(
      alerts(
        alert({
          tool: "Scorecard",
          rule: "CodeReviewID",
          path: "no file associated with this alert",
        }),
        alert({ path: "src/a.ts" }),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("1 open code-scanning alert(s)")
    expect(result.rationale).toContain("src/a.ts:7")
    expect(result.rationale).not.toContain("CodeReviewID")
  })

  it("fails an alert in code that ships, naming it, and writes nothing", async () => {
    const result = await policy(
      alerts(alert({ path: "src/build/docs.ts", rule: "js/incomplete-sanitization", line: 22 })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "1 open code-scanning alert(s) are in code that builds, runs or ships, so they must be fixed (there is no exception for them):",
        "- js/incomplete-sanitization in src/build/docs.ts:22 [high]: A regex that cannot match.",
      ].join("\n"),
    })
    expect(() => readFileSync(registryPath(), "utf8")).toThrow()
  })

  it("lists only the shipped alerts when development-only ones are mixed in", async () => {
    const result = await policy(
      alerts(alert({ path: "src/a.ts" }), alert({ path: "test/a.test.ts" })),
    )
    expect(result.rationale).toContain("1 open code-scanning alert(s)")
    expect(result.rationale).toContain("src/a.ts:7")
    expect(result.rationale).not.toContain("test/a.test.ts")
  })

  it("caps the listing at 20 and says how many more", async () => {
    const many = Array.from({ length: 23 }, (_, i) => alert({ path: `src/f${String(i)}.ts` }))
    const result = await policy(alerts(...many))
    expect(result.rationale).toContain("23 open code-scanning alert(s)")
    expect(result.rationale).toContain("src/f19.ts:7")
    expect(result.rationale).not.toContain("src/f20.ts")
    expect(result.rationale).toContain("- ...and 3 more")
    const exactly = await policy(alerts(...many.slice(0, 20)))
    expect(exactly.rationale).not.toContain("more")
  })

  it("treats the code a root action.yml runs as shipped, though package.json leaves it out", async () => {
    writePackage({ name: "x", files: ["dist"] })
    writeFileSync(
      path.join(cwd, "action.yml"),
      'runs:\n  using: composite\n  steps:\n    - run: bash "$ACTION_PATH/scripts/github-action/run-cli.sh"\n',
    )
    const shipped = await policy(alerts(alert({ path: "scripts/github-action/report.mjs" })))
    expect(shipped.outcome).toBe("fail")
    expect(shipped.rationale).toContain("scripts/github-action/report.mjs:7")
    const dev = await policy(alerts(alert({ path: "scripts/other.mjs" })))
    expect(dev.outcome).toBe("pass")
  })

  it("reads action.yaml when there is no action.yml, and an unreadable package.json as no files", async () => {
    writeFileSync(path.join(cwd, "package.json"), "{not json", "utf8")
    writeFileSync(path.join(cwd, "action.yaml"), "runs:\n  using: node20\n  main: lib/index.js\n")
    const result = await policy(alerts(alert({ path: "lib/index.js" })))
    expect(result.outcome).toBe("fail")
  })

  it("reads action.yaml when there is no action.yml, so the development directory it runs from ships", async () => {
    writeFileSync(
      path.join(cwd, "action.yaml"),
      "runs:\n  using: node20\n  main: scripts/github-action/main.mjs\n",
    )
    const shipped = await policy(alerts(alert({ path: "scripts/github-action/main.mjs" })))
    expect(shipped.outcome).toBe("fail")
    expect(shipped.rationale).toContain("scripts/github-action/main.mjs:7")
  })

  it("treats a published scripts directory as shipped", async () => {
    writePackage({ name: "x", files: [7, "scripts"] })
    const result = await policy(alerts(alert({ path: "scripts/run.mjs" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("scripts/run.mjs:7")
  })

  it("scaffolds one complete record per rule and file, and passes", async () => {
    const result = await policy(
      alerts(
        alert({ number: 1, line: 1 }),
        alert({ number: 2, line: 9 }),
        alert({ number: 3, rule: "js/other", path: ".github/workflows/ci.yml" }),
      ),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale:
        "3 open code-scanning alert(s), all in development-only code and rejected by a record in .repo-contract/exceptions/code-scanning.json.",
    })
    const records = readRegistry().exceptions
    expect(records.map((r) => r["id"])).toEqual([
      "code-scanning:js/bad-tag-filter@test/a.test.ts",
      "code-scanning:js/other@.github/workflows/ci.yml",
    ])
    expect(records[0]).toMatchObject({
      justification: DEV_TEXT,
      method: "policy-rule",
      exceptionType: "dev-only-not-shipped",
    })
  })

  it("keeps an existing complete record as it is", async () => {
    writeRegistry([
      {
        ...createDevStub(
          { id: "x", rule: "js/bad-tag-filter", path: "test/a.test.ts" },
          "code-scanning:js/bad-tag-filter@test/a.test.ts",
        ),
        justification: "My own words for this one.",
      },
    ])
    expect((await policy(alerts(alert()))).outcome).toBe("pass")
    expect(readRegistry().exceptions[0]?.["justification"]).toBe("My own words for this one.")
  })

  it("fails a record someone blanked, listing it", async () => {
    writeRegistry([
      {
        ...createDevStub(
          { id: "x", rule: "js/bad-tag-filter", path: "test/a.test.ts" },
          "code-scanning:js/bad-tag-filter@test/a.test.ts",
        ),
        remediation: "",
      },
    ])
    expect(await policy(alerts(alert()))).toEqual({
      outcome: "fail",
      rationale: [
        "1 development-only finding(s) have an incomplete record in .repo-contract/exceptions/code-scanning.json:",
        "- code-scanning:js/bad-tag-filter@test/a.test.ts",
      ].join("\n"),
    })
  })

  it("fails, leaving the file alone, when the registry is malformed", async () => {
    writeRegistry([{ id: "code-scanning:js/x@test/a.ts", exceptionType: "accepted-risk" }])
    const before = readFileSync(registryPath(), "utf8")
    const result = await policy(alerts(alert()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      ".repo-contract/exceptions/code-scanning.json failed to load and was left unchanged:",
    )
    expect(result.rationale).toContain(
      "- exceptions[0].version must be the number 2 (or the legacy 1) (got undefined).",
    )
    expect(readFileSync(registryPath(), "utf8")).toBe(before)
  })

  it("fails with the persisted-write rationale when the registry path is a symlink", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    const target = path.join(cwd, "real-registry.json")
    writeFileSync(target, JSON.stringify({ exceptions: [] }), "utf8")
    symlinkSync(target, registryPath())
    try {
      const result = await policy(alerts(alert()))
      expect(result.outcome).toBe("fail")
      expect(result.rationale).toContain("is a symlink")
    } finally {
      // Windows cannot remove a dangling file symlink during the recursive cleanup, so drop it first.
      unlinkSync(registryPath())
    }
  })

  it("ignores a package.json that cannot be read or has no files list", async () => {
    writeFileSync(path.join(cwd, "package.json"), "{ not json")
    expect((await policy(alerts(alert()))).outcome).toBe("pass")
    writePackage({ name: "x", files: "dist" })
    expect((await policy(alerts(alert({ path: "test/b.test.ts" })))).outcome).toBe("pass")
  })
})
