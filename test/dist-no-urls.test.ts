import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createDistUrlStub,
  DIST_URL_SCHEMA,
  deriveDistUrlId,
  distinctUrls,
  distNoUrlsCheck,
  evaluateDistUrls,
} from "../checks/dist-no-urls.js"
import { makeContext, makeJsonResult, makeResult, BLANK_V2 } from "./support.js"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-dist-no-urls-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

const registryPath = () => path.join(cwd, ".repo-contract/exceptions/dist-urls.json")
function writeRegistry(exceptions: readonly unknown[]): void {
  mkdirSync(path.dirname(registryPath()), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify({ exceptions }), "utf8")
}
const readRegistry = (): { exceptions: Record<string, unknown>[] } =>
  JSON.parse(readFileSync(registryPath(), "utf8"))

const URL_A = "https://a.test/x"
const complete = (url: string, overrides: Record<string, unknown> = {}) => ({
  id: deriveDistUrlId(url),
  version: 1,
  justification: "Part of a bundled dependency's message.",
  alternatives: "Stop bundling it.",
  remediation: "Revisit on replacement.",
  method: "independent-human-review",
  exceptionType: "accepted-risk",
  url,
  ...overrides,
})
const report = (findings: readonly unknown[], extra: Record<string, unknown> = {}) =>
  makeJsonResult({ dirExists: true, filesScanned: 7, findings, ...extra })
const finding = (url: string, file = "index.js", line = 1) => ({ file, line, url })

describe("distNoUrlsCheck() -- run", () => {
  it("scans dist by default and a custom directory when given, as JSON", () => {
    const run = distNoUrlsCheck().run as readonly string[]
    expect([run[0], run[1], run[3]]).toEqual(["node", "-e", "dist"])
    expect((distNoUrlsCheck("out").run as readonly string[])[3]).toBe("out")
    expect(distNoUrlsCheck().output).toEqual({ format: "json" })
  })
})

describe("deriveDistUrlId() / createDistUrlStub() / distinctUrls()", () => {
  it("namespaces the id by the URL", () => {
    expect(deriveDistUrlId(URL_A)).toBe("dist-url:https://a.test/x")
  })
  it("scaffolds a fully blank stub carrying only the url", () => {
    expect(createDistUrlStub({ id: "dist-url:u", url: "u", where: "f:1" }, "dist-url:u")).toEqual({
      id: "dist-url:u",
      version: 2,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      ...BLANK_V2,
      url: "u",
    })
  })
  it("keeps one entry per distinct URL, remembering the first location", () => {
    expect(
      distinctUrls([finding("u1", "a.js", 3), finding("u2", "b.js", 4), finding("u1", "c.js", 9)]),
    ).toEqual([
      { id: "dist-url:u1", url: "u1", where: "a.js:3" },
      { id: "dist-url:u2", url: "u2", where: "b.js:4" },
    ])
    expect(distinctUrls([])).toEqual([])
  })
})

describe("DIST_URL_SCHEMA.validateRecord()", () => {
  const core = { id: deriveDistUrlId(URL_A), version: 1 as const, justification: "j" }
  const raw = complete(URL_A)
  it("builds the full record when valid", () => {
    const errors: string[] = []
    expect(DIST_URL_SCHEMA.validateRecord(core, raw, 0, errors)).toEqual(
      complete(URL_A, { justification: "j" }),
    )
    expect(errors).toEqual([])
  })
  it("rejects invalid security fields", () => {
    const errors: string[] = []
    expect(
      DIST_URL_SCHEMA.validateRecord(core, { ...raw, method: "nope" }, 0, errors),
    ).toBeUndefined()
    expect(errors[0]).toContain("exceptions[0].method")
  })
  it("rejects a missing or empty url", () => {
    for (const url of [undefined, ""]) {
      const errors: string[] = []
      expect(DIST_URL_SCHEMA.validateRecord(core, { ...raw, url }, 2, errors)).toBeUndefined()
      expect(errors).toEqual(["exceptions[2].url must be a non-empty string."])
    }
  })
  it("rejects an id that does not match its own url, without double-reporting", () => {
    const errors: string[] = []
    expect(
      DIST_URL_SCHEMA.validateRecord({ ...core, id: "dist-url:other" }, raw, 1, errors),
    ).toBeUndefined()
    expect(errors).toEqual([
      'exceptions[1].id "dist-url:other" does not match the id derived from its own url ("dist-url:https://a.test/x").',
    ])
  })
})

describe("evaluateDistUrls()", () => {
  const shipped = { id: deriveDistUrlId(URL_A), url: URL_A, where: "index.js:1" }
  const registry = (
    over: Partial<{ activeRecords: unknown[]; staleRecords: unknown[]; newStubIds: string[] }> = {},
  ) => ({ activeRecords: [], staleRecords: [], newStubIds: [], ...over }) as never

  it("passes cleanly when nothing ships and nothing is recorded", () => {
    expect(evaluateDistUrls([], registry(), "dist", 5)).toEqual({
      outcome: "pass",
      rationale: 'No URLs in 5 file(s) under "dist".',
    })
  })
  it("passes when every URL has a complete record, noting scaffolded stubs", () => {
    const withStubs = evaluateDistUrls(
      [shipped],
      registry({ activeRecords: [complete(URL_A)], newStubIds: ["x"] }),
      "dist",
      5,
    )
    expect(withStubs).toEqual({
      outcome: "pass",
      rationale:
        '1 distinct URL(s) under "dist": all explained by a complete exception record. (1 new record(s) scaffolded blank in .repo-contract/exceptions/dist-urls.json)',
    })
    expect(
      evaluateDistUrls([shipped], registry({ activeRecords: [complete(URL_A)] }), "dist", 5)
        .rationale,
    ).not.toContain("scaffolded")
    expect(evaluateDistUrls([], registry({ newStubIds: ["x"] }), "dist", 5).rationale).toBe(
      'No URLs in 5 file(s) under "dist". (1 new record(s) scaffolded blank in .repo-contract/exceptions/dist-urls.json)',
    )
  })
  it("fails an incomplete record, listing what is missing and where the URL first appears", () => {
    const result = evaluateDistUrls(
      [shipped],
      registry({ activeRecords: [complete(URL_A, { justification: "", method: "" })] }),
      "dist",
      5,
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "- https://a.test/x (first at index.js:1): exception incomplete (missing: justification, method)",
    )
    expect(result.rationale).toContain("1 shipped URL(s) or stale record(s) need attention")
  })
  it("fails a URL with no reconciled record as an integrity failure", () => {
    const result = evaluateDistUrls([shipped], registry(), "dist", 5)
    expect(result.rationale).toContain(
      "no reconciled exception record (registry integrity failure)",
    )
  })
  it("fails a stale record even when everything else is fine, counting it", () => {
    const result = evaluateDistUrls(
      [],
      registry({ staleRecords: [complete("https://gone.test")] }),
      "dist",
      5,
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale.startsWith("1 shipped URL(s) or stale record(s) need attention")).toBe(
      true,
    )
    expect(result.rationale).toContain(
      '- Stale exception in .repo-contract/exceptions/dist-urls.json: "dist-url:https://gone.test" -- this URL no longer ships; delete this entry.',
    )
  })
  it("renders the exact failure text, counting offenders and stale records together", () => {
    const result = evaluateDistUrls(
      [shipped],
      registry({
        activeRecords: [complete(URL_A, { justification: "" })],
        staleRecords: [complete("https://gone.test")],
      }),
      "dist",
      5,
    )
    expect(result.rationale).toBe(
      [
        "2 shipped URL(s) or stale record(s) need attention -- Socket.dev flags every URL in a published package; remove it from the source (comments, JSDoc, string literals, sourcemap content) or explain it in .repo-contract/exceptions/dist-urls.json:",
        "- https://a.test/x (first at index.js:1): exception incomplete (missing: justification)",
        '- Stale exception in .repo-contract/exceptions/dist-urls.json: "dist-url:https://gone.test" -- this URL no longer ships; delete this entry.',
      ].join("\n"),
    )
  })
  it("caps the listing at 20 and says how many more", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({
      id: `dist-url:u${String(i)}`,
      url: `u${String(i)}`,
      where: "f:1",
    }))
    const result = evaluateDistUrls(many, registry(), "dist", 5)
    expect(result.rationale).toContain("23 shipped URL(s)")
    expect(result.rationale).toContain("- u19 (first at f:1)")
    expect(result.rationale).not.toContain("- u20 (first")
    expect(result.rationale).toContain("- ...and 3 more")
    const exactly = evaluateDistUrls(many.slice(0, 20), registry(), "dist", 5)
    expect(exactly.rationale).not.toContain("more")
  })
})

describe("distNoUrlsCheck() -- policy", () => {
  const policy = (result: ReturnType<typeof makeResult>, dir?: string) =>
    distNoUrlsCheck(dir).policy(makeContext(result))

  it("fails closed on abnormal termination and unparseable or malformed scan output", async () => {
    expect(await policy(makeResult({ status: "timed_out" }))).toEqual({
      outcome: "fail",
      rationale: "the dist URL scan did not run to completion (status: timed_out).",
    })
    const unparseable = "The dist URL scan output could not be parsed."
    expect(
      (await policy(makeResult({ output: { format: "json", success: false, error: "x" } })))
        .rationale,
    ).toBe(unparseable)
    expect(await policy(makeResult())).toEqual({ outcome: "fail", rationale: unparseable })
    for (const bad of [
      null,
      5,
      "x",
      {},
      { dirExists: true, filesScanned: 1 },
      { dirExists: "y", filesScanned: 1, findings: [] },
      { dirExists: true, filesScanned: "1", findings: [] },
      { dirExists: true, filesScanned: 1, findings: {} },
    ]) {
      expect((await policy(makeJsonResult(bad))).rationale).toBe(unparseable)
    }
  })

  it("fails when the build directory is missing", async () => {
    const result = await policy(report([], { dirExists: false }), "out")
    expect(result).toEqual({
      outcome: "fail",
      rationale: 'Build output directory "out" does not exist -- build before running this check.',
    })
  })

  it("passes with no URLs and leaves an empty registry behind", async () => {
    const result = await policy(report([]))
    expect(result.outcome).toBe("pass")
    expect(readRegistry().exceptions).toEqual([])
  })

  it("scaffolds a blank stub for a new URL and fails until it is filled in", async () => {
    const result = await policy(
      report([finding(URL_A, "index.js", 4), finding(URL_A, "other.js", 9)]),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "- https://a.test/x (first at index.js:4): exception incomplete (missing: justification, alternatives, remediation, method, exceptionType, ruleBroken, attempted, constraint, whyPreferable, residualRisk, revisitWhen)",
    )
    expect(readRegistry().exceptions).toEqual([
      expect.objectContaining({ id: "dist-url:https://a.test/x", justification: "", url: URL_A }),
    ])
  })

  it("passes once the record is complete", async () => {
    writeRegistry([complete(URL_A)])
    const result = await policy(report([finding(URL_A)]))
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("1 distinct URL(s)")
  })

  it("fails a stale record", async () => {
    writeRegistry([complete(URL_A)])
    const result = await policy(report([]))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("this URL no longer ships")
  })

  it("fails with the rendered error list when the registry on disk is malformed, leaving it unchanged", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    writeFileSync(
      registryPath(),
      JSON.stringify({ exceptions: [{ id: "bad", version: 1 }] }),
      "utf8",
    )
    const result = await policy(report([]))
    expect(result.outcome).toBe("fail")
    expect(result.rationale.split("\n")[0]).toBe(
      ".repo-contract/exceptions/dist-urls.json failed to load and was left unchanged:",
    )
    expect(result.rationale).toContain(
      '- exceptions[0].id must be a non-empty string beginning with "dist-url:"',
    )
  })

  it("fails with the write rationale when the registry path is a symlink", async () => {
    const target = path.join(cwd, "real.json")
    writeFileSync(target, JSON.stringify({ exceptions: [] }), "utf8")
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    symlinkSync(target, registryPath())
    const result = await policy(report([finding(URL_A)]))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("is a symlink")
  })
})
