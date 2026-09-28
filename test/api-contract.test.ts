import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { evaluateApiContractPolicy } from "../checks/api-contract.js"
import type {
  ApiContractEvidence,
  ApiContractTargetResult,
} from "../scripts/api-contract/evidence-types.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

/** A minimal, otherwise-unchanged target result -- each test overrides only what it needs. */
function baseTarget(overrides: Partial<ApiContractTargetResult> = {}): ApiContractTargetResult {
  return {
    target: "index",
    initialBaseline: false,
    current: {
      packageName: "@maverickcer/example",
      apiExtractorVersion: "7.58.13",
      apiJsonSchemaVersion: 1013,
      apiJsonHash: "current-hash",
    },
    diff: [],
    lowerTierDiff: [],
    impact: "unchanged",
    requiredLevel: "none",
    minimumRequiredVersion: "1.0.0",
    baselineVersion: "1.0.0",
    summary: "No public API changes detected.",
    ...overrides,
  }
}

function baseEvidence(overrides: Partial<ApiContractEvidence> = {}): ApiContractEvidence {
  return {
    currentVersion: "1.0.0",
    targets: [baseTarget()],
    requiredLevel: "none",
    minimumRequiredVersion: "1.0.0",
    summary: "[index] No public API changes detected.",
    changesets: { changesetCount: 0, declaredLevel: "none", satisfied: true },
    ...overrides,
  }
}

describe("evaluateApiContractPolicy", () => {
  it("passes when nothing changed and the branch declares no changeset", () => {
    const result = evaluateApiContractPolicy({ evidence: baseEvidence() })
    expect(result.outcome).toBe("pass")
  })

  it("passes on the initial baseline run", () => {
    const evidence = baseEvidence({
      targets: [
        baseTarget({
          initialBaseline: true,
          baseline: undefined,
          diff: [],
          impact: "unchanged",
          requiredLevel: "none",
          minimumRequiredVersion: "0.1.0",
          baselineVersion: undefined,
          summary: "No historical public API contract exists for this target.",
        }),
      ],
      minimumRequiredVersion: "0.1.0",
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result.outcome).toBe("pass")
  })

  it("fails a breaking change with no changeset, naming the target and the breaking path", () => {
    const evidence = baseEvidence({
      targets: [
        baseTarget({
          diff: [
            {
              id: "ref#export-removed",
              path: "removedFn",
              kind: "export-removed",
              compatibility: "breaking",
              explanation: "Removed removedFn.",
            },
          ],
          impact: "breaking",
          requiredLevel: "major",
          minimumRequiredVersion: "2.0.0",
        }),
      ],
      requiredLevel: "major",
      minimumRequiredVersion: "2.0.0",
      changesets: { changesetCount: 0, declaredLevel: "none", satisfied: false },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("major")
    expect(result.rationale).toContain("[index] removedFn")
    expect(result.rationale).toContain("npx changeset add")
  })

  it("fails when a changeset under-declares the required bump", () => {
    const evidence = baseEvidence({
      targets: [baseTarget({ impact: "breaking", requiredLevel: "major", diff: [] })],
      requiredLevel: "major",
      changesets: { changesetCount: 1, declaredLevel: "patch", satisfied: false },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("declare a `major` bump")
  })

  it("passes when a changeset declares at least the required bump", () => {
    const evidence = baseEvidence({
      targets: [baseTarget({ impact: "breaking", requiredLevel: "major" })],
      requiredLevel: "major",
      minimumRequiredVersion: "2.0.0",
      changesets: { changesetCount: 1, declaredLevel: "major", satisfied: true },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("Minimum required version if released now: 2.0.0.")
  })

  it("warns, never fails, when a target's impact is unknown", () => {
    const evidence = baseEvidence({
      targets: [
        baseTarget({
          impact: "unknown",
          requiredLevel: undefined,
          minimumRequiredVersion: undefined,
        }),
      ],
      requiredLevel: undefined,
      minimumRequiredVersion: undefined,
      changesets: { changesetCount: 0, declaredLevel: "none", satisfied: null },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result.outcome).toBe("warn")
  })

  it("fails on a stale schema-version literal even when the changeset would otherwise satisfy the requirement", () => {
    const evidence = baseEvidence({
      targets: [
        baseTarget({
          diff: [
            {
              id: "ref#schema-version-literal",
              path: "MySchema",
              kind: "schema-version-literal-stale",
              compatibility: "breaking",
              explanation: "MySchema changed shape but its `version` literal is still 1.",
            },
          ],
          impact: "breaking",
          requiredLevel: "major",
        }),
      ],
      requiredLevel: "major",
      changesets: { changesetCount: 1, declaredLevel: "major", satisfied: true },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("Internal schema-version consistency violation")
  })

  it("aggregates required level across several targets, naming each in the breaking-paths list", () => {
    const evidence = baseEvidence({
      targets: [
        baseTarget({
          target: "runtime",
          diff: [
            {
              id: "a#export-removed",
              path: "removedFn",
              kind: "export-removed",
              compatibility: "breaking",
              explanation: "Removed removedFn.",
            },
          ],
          impact: "breaking",
          requiredLevel: "major",
        }),
        baseTarget({ target: "build" }),
      ],
      requiredLevel: "major",
      changesets: { changesetCount: 0, declaredLevel: "none", satisfied: false },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("[runtime] removedFn")
  })

  it("fail: joins several breaking paths with a comma, excludes non-breaking diff items, pluralizes changesets, and appends the lower-tier line", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [
        baseTarget({
          target: "index",
          diff: [
            {
              id: "b1#export-removed",
              path: "removedFn",
              kind: "export-removed",
              compatibility: "breaking",
              explanation: "Removed removedFn.",
            },
            {
              id: "c1#export-added",
              path: "addedFn",
              kind: "export-added",
              compatibility: "compatible",
              explanation: "Added addedFn.",
            },
          ],
          lowerTierDiff: [
            {
              id: "lt1#documentation-only",
              path: "internalThing",
              kind: "documentation-only",
              compatibility: "compatible",
              explanation: "doc change",
            },
          ],
          impact: "breaking",
          requiredLevel: "major",
        }),
        baseTarget({
          target: "runtime",
          diff: [
            {
              id: "b2#export-removed",
              path: "otherRemoved",
              kind: "export-removed",
              compatibility: "breaking",
              explanation: "Removed otherRemoved.",
            },
          ],
          lowerTierDiff: [
            {
              id: "lt2#documentation-only",
              path: "internalOther1",
              kind: "documentation-only",
              compatibility: "compatible",
              explanation: "doc change",
            },
            {
              id: "lt3#documentation-only",
              path: "internalOther2",
              kind: "documentation-only",
              compatibility: "compatible",
              explanation: "doc change",
            },
          ],
        }),
      ],
      requiredLevel: "major",
      changesets: { changesetCount: 2, declaredLevel: "patch", satisfied: false },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "Release level: 2 changeset(s) declare `patch`; the API diff requires `major`.",
        "",
        "Breaking public-API change(s): `[index] removedFn`, `[runtime] otherRemoved`.",
        "",
        "The changesets on this branch do not declare a `major` release. Run `npx changeset add` and declare a `major` bump for this change, so Changesets bumps the version correctly.",
        "",
        "3 non-public change(s) also detected across 2 target(s) (informational only).",
      ].join("\n"),
    })
  })

  it("fail: omits the breaking-changes line entirely when no diff item is compatibility 'breaking', uses 'minor' remediation, and has no lower-tier line", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [
        baseTarget({
          diff: [
            {
              id: "c1#export-added",
              path: "addedFn",
              kind: "export-added",
              compatibility: "compatible",
              explanation: "Added addedFn.",
            },
          ],
          impact: "compatible",
          requiredLevel: "minor",
        }),
      ],
      requiredLevel: "minor",
      changesets: { changesetCount: 0, declaredLevel: "none", satisfied: false },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "Release level: 0 changeset(s) declare `none`; the API diff requires `minor`.",
        "",
        "The changesets on this branch do not declare a `minor` release. Run `npx changeset add` and declare a `minor` bump for this change, so Changesets bumps the version correctly.",
      ].join("\n"),
    })
  })

  it("fail: singular changeset wording ('1 changeset declares') and 'patch' remediation text", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [baseTarget({ diff: [], impact: "compatible", requiredLevel: "patch" })],
      requiredLevel: "patch",
      changesets: { changesetCount: 1, declaredLevel: "none", satisfied: false },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "Release level: 1 changeset declares `none`; the API diff requires `patch`.",
        "",
        "The changesets on this branch do not declare a `patch` release. Run `npx changeset add` and declare a `patch` bump for this change, so Changesets bumps the version correctly.",
      ].join("\n"),
    })
  })

  it("fail: falls back to a `?` required level and the generic remediation sentence when the required level is unknown but changesets are unsatisfied", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [
        baseTarget({
          diff: [],
          impact: "unknown",
          requiredLevel: undefined,
          minimumRequiredVersion: undefined,
        }),
      ],
      requiredLevel: undefined,
      minimumRequiredVersion: undefined,
      changesets: { changesetCount: 3, declaredLevel: "none", satisfied: false },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "Release level: 3 changeset(s) declare `none`; the API diff requires `unknown`.",
        "",
        "The changesets on this branch do not declare a `?` release. Run `npx changeset add` and declare the required bump for this change, so Changesets bumps the version correctly.",
      ].join("\n"),
    })
  })

  it("stale-literal fail: bullets every violation with its target prefix, and has no lower-tier line when nothing else changed", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [
        baseTarget({
          target: "index",
          diff: [
            {
              id: "s1#schema-version-literal",
              path: "SchemaA",
              kind: "schema-version-literal-stale",
              compatibility: "breaking",
              explanation: "SchemaA changed shape but its `version` literal is still 1.",
            },
          ],
          impact: "breaking",
          requiredLevel: "major",
        }),
        baseTarget({
          target: "runtime",
          diff: [
            {
              id: "s2#schema-version-literal",
              path: "SchemaB",
              kind: "schema-version-literal-stale",
              compatibility: "breaking",
              explanation: "SchemaB changed shape but its `version` literal is still 1.",
            },
          ],
        }),
      ],
      requiredLevel: "major",
      changesets: { changesetCount: 1, declaredLevel: "major", satisfied: true },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "Internal schema-version consistency violation(s):",
        "- [index] SchemaA changed shape but its `version` literal is still 1.",
        "- [runtime] SchemaB changed shape but its `version` literal is still 1.",
      ].join("\n"),
    })
  })

  it("stale-literal fail: includes the lower-tier line when non-public changes also exist", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [
        baseTarget({
          diff: [
            {
              id: "s1#schema-version-literal",
              path: "SchemaA",
              kind: "schema-version-literal-stale",
              compatibility: "breaking",
              explanation: "SchemaA changed shape.",
            },
          ],
          lowerTierDiff: [
            {
              id: "lt1#documentation-only",
              path: "internalThing",
              kind: "documentation-only",
              compatibility: "compatible",
              explanation: "doc change",
            },
          ],
          impact: "breaking",
          requiredLevel: "major",
        }),
      ],
      requiredLevel: "major",
      changesets: { changesetCount: 1, declaredLevel: "major", satisfied: true },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "Internal schema-version consistency violation(s):",
        "- [index] SchemaA changed shape.",
        "",
        "1 non-public change(s) also detected across 1 target(s) (informational only).",
      ].join("\n"),
    })
  })

  it("warn: exact rationale with no lower-tier line", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [
        baseTarget({
          impact: "unknown",
          requiredLevel: undefined,
          minimumRequiredVersion: undefined,
        }),
      ],
      requiredLevel: undefined,
      minimumRequiredVersion: undefined,
      changesets: { changesetCount: 0, declaredLevel: "none", satisfied: null },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "warn",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "The public contract could not be deterministically classified, so no minimum required level can be established. The branch's changesets declare `none`. Manually confirm that is an appropriate bump for this change.",
      ].join("\n"),
    })
  })

  it("warn: exact rationale including the lower-tier line when non-public changes exist", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [
        baseTarget({
          impact: "unknown",
          requiredLevel: undefined,
          minimumRequiredVersion: undefined,
          lowerTierDiff: [
            {
              id: "lt1#documentation-only",
              path: "internalThing",
              kind: "documentation-only",
              compatibility: "compatible",
              explanation: "doc change",
            },
          ],
        }),
        baseTarget({ target: "runtime" }),
      ],
      requiredLevel: undefined,
      minimumRequiredVersion: undefined,
      changesets: { changesetCount: 0, declaredLevel: "patch", satisfied: null },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "warn",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "The public contract could not be deterministically classified, so no minimum required level can be established. The branch's changesets declare `patch`. Manually confirm that is an appropriate bump for this change.",
        "",
        "1 non-public change(s) also detected across 2 target(s) (informational only).",
      ].join("\n"),
    })
  })

  it("pass: exact rationale with the minimum-version line, singular changeset wording, and no lower-tier line", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [baseTarget({ requiredLevel: "none", minimumRequiredVersion: "1.2.0" })],
      requiredLevel: "none",
      minimumRequiredVersion: "1.2.0",
      changesets: { changesetCount: 1, declaredLevel: "none", satisfied: true },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "pass",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "Minimum required version if released now: 1.2.0.",
        "Release level: 1 changeset declares `none`; the API diff requires `none`.",
      ].join("\n"),
    })
  })

  it("pass: omits the minimum-version line entirely when absent, pluralizes changesets, and includes the lower-tier line", () => {
    const evidence = baseEvidence({
      summary: "TEST SUMMARY",
      targets: [
        baseTarget({
          requiredLevel: "none",
          minimumRequiredVersion: undefined,
          lowerTierDiff: [
            {
              id: "lt1#documentation-only",
              path: "internalThing",
              kind: "documentation-only",
              compatibility: "compatible",
              explanation: "doc change",
            },
          ],
        }),
      ],
      requiredLevel: "none",
      minimumRequiredVersion: undefined,
      changesets: { changesetCount: 2, declaredLevel: "none", satisfied: true },
    })
    const result = evaluateApiContractPolicy({ evidence })
    expect(result).toEqual({
      outcome: "pass",
      rationale: [
        "Contract impact: TEST SUMMARY",
        "",
        "Release level: 2 changeset(s) declare `none`; the API diff requires `none`.",
        "",
        "1 non-public change(s) also detected across 1 target(s) (informational only).",
      ].join("\n"),
    })
  })
})

/**
 * This package's own `scripts/api-contract/check.ts` -- the same absolute path
 * `checks/api-contract.ts`'s own `checkScript` constant resolves to (computed there from
 * `import.meta.url` one level up, in `checks/`; computed here from this test file's own
 * `import.meta.url` one level up, in `test/` -- both siblings of the repo root). Asserted as an
 * exact value (not a suffix match) so a mutant that drops the `".."` segment -- which would
 * resolve to a nonexistent `checks/scripts/api-contract/check.ts` instead -- still fails: a suffix
 * match alone can't tell the two apart.
 */
const expectedCheckScript = fileURLToPath(
  new URL("../scripts/api-contract/check.ts", import.meta.url),
)

describe("apiContract (module export -- checks/api-contract.ts's `hasTypedocConfig` branch)", () => {
  let dir: string | undefined
  let cacheBust = 0

  afterEach(() => {
    vi.restoreAllMocks()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  /**
   * Imports a fresh module instance with `process.cwd()` mocked to `cwd` -- `hasTypedocConfig` is
   * computed once, at import time, from `process.cwd()`, so exercising both branches requires a
   * fresh module per `cwd`. Uses a cache-busting query string (Vite/Vitest's own documented
   * re-import technique) rather than `vi.resetModules()`, which clears the *entire* shared module
   * registry and was observed to disturb unrelated static-mutant coverage attribution elsewhere
   * (`checks/shared.ts`'s `packageRoot`) when run under Stryker.
   */
  async function importFresh(cwd: string): Promise<typeof import("../checks/api-contract.js")> {
    vi.spyOn(process, "cwd").mockReturnValue(cwd)
    cacheBust += 1
    const specifier = `../checks/api-contract.js?cache-bust=${String(cacheBust)}`
    return import(/* @vite-ignore */ specifier) as Promise<
      typeof import("../checks/api-contract.js")
    >
  }

  it("with typedoc.json: runs the real check script with --release-tag=public and requests JSON output", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-api-contract-test-"))
    writeFileSync(path.join(dir, "typedoc.json"), "{}")
    const mod = await importFresh(dir)

    expect(mod.apiContract.run).toEqual(["tsx", expectedCheckScript, "--release-tag=public"])
    expect(mod.apiContract.output).toEqual({ format: "json" })
  })

  it("with typedoc.json: policy fails, naming the api-contract check, when the process terminated abnormally", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-api-contract-test-"))
    writeFileSync(path.join(dir, "typedoc.json"), "{}")
    const mod = await importFresh(dir)

    const result = await mod.apiContract.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "the api-contract check did not run to completion (status: timed_out).",
    })
  })

  it("with typedoc.json: policy fails with no appended output when the check produced none at all (no throw from the optional-chained success check)", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-api-contract-test-"))
    writeFileSync(path.join(dir, "typedoc.json"), "{}")
    const mod = await importFresh(dir)

    const result = await mod.apiContract.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "ApiContract: check output could not be parsed as JSON.",
    })
  })

  it("with typedoc.json: policy fails and appends combined stdout/stderr when the check's output failed to parse as JSON", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-api-contract-test-"))
    writeFileSync(path.join(dir, "typedoc.json"), "{}")
    const mod = await importFresh(dir)

    const result = await mod.apiContract.policy(
      makeContext(
        makeResult({
          output: { format: "json", success: false, error: "bad" },
          stdout: "raw check output",
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "ApiContract: check output could not be parsed as JSON.\nraw check output",
    })
  })

  it("with typedoc.json: policy delegates to evaluateApiContractPolicy on successfully parsed evidence", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-api-contract-test-"))
    writeFileSync(path.join(dir, "typedoc.json"), "{}")
    const mod = await importFresh(dir)

    const evidence = baseEvidence()
    const result = await mod.apiContract.policy(makeContext(makeJsonResult(evidence)))
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("Contract impact:")
  })

  it("without typedoc.json: stub check runs a no-op and always passes with a fixed rationale", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-api-contract-test-no-typedoc-"))
    const mod = await importFresh(dir)

    expect(mod.apiContract.run).toEqual(["node", "-e", ""])
    const result = await mod.apiContract.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale:
        "ApiContract: no typedoc.json -- this package documents no public entry points to compare.",
    })
  })
})
