import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { devOnlyFindings, securityDevDeps } from "../checks/security-dev-deps.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const audit = (vulns: Record<string, { severity: string; range: string }>) => ({
  vulnerabilities: vulns,
})
const envelope = (all: object, production: object) => makeJsonResult({ ok: true, all, production })
const policy = (result: ReturnType<typeof makeJsonResult>) =>
  securityDevDeps().policy(makeContext(result)) as ReturnType<typeof Object>

describe("devOnlyFindings()", () => {
  it("keeps what is in the whole tree and not in the production tree, most severe first", () => {
    const all = audit({
      lodash: { severity: "high", range: "<4.17.21" },
      vitest: { severity: "moderate", range: "3.0.0 - 3.2.7" },
      shipped: { severity: "critical", range: "<1" },
      zed: { severity: "moderate", range: "<2" },
      mystery: { severity: "weird", range: "<3" },
    })
    const production = audit({ shipped: { severity: "critical", range: "<1" } })
    expect(devOnlyFindings(all, production).map((f) => `${f.name}:${f.severity}`)).toEqual([
      "lodash:high",
      "vitest:moderate",
      "zed:moderate",
      "mystery:weird",
    ])
  })

  it("tolerates reports with no vulnerabilities and entries with missing fields", () => {
    expect(devOnlyFindings({}, {})).toEqual([])
    expect(devOnlyFindings({ vulnerabilities: { x: {} } }, {})).toEqual([
      { name: "x", severity: "unknown", range: "unknown" },
    ])
  })
})

describe("securityDevDeps() policy", () => {
  it("runs the bundled script that audits both trees", () => {
    const run = securityDevDeps().run as readonly string[]
    expect(run[0]).toBe("node")
    expect(path.basename(run[1] as string)).toBe("audit-dev-deps.mjs")
  })

  it("passes when nothing is reachable only through development dependencies", async () => {
    const result = await policy(envelope(audit({}), audit({})))
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain(
      "no advisory is reachable only through development dependencies",
    )
  })

  it("warns, listing the packages, for lower-severity development-only advisories", async () => {
    const result = await policy(
      envelope(audit({ vitest: { severity: "moderate", range: "3.0.0 - 3.2.7" } }), audit({})),
    )
    expect(result).toEqual({
      outcome: "warn",
      rationale: [
        "Dev dependency audit: 1 advisory(ies) reachable only through development dependencies (none critical):",
        "- vitest [moderate] 3.0.0 - 3.2.7",
      ].join("\n"),
    })
  })

  it("caps the list and counts the rest", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [
        `p${String(i).padStart(2, "0")}`,
        { severity: "low", range: "<1" },
      ]),
    )
    const result = await policy(envelope(audit(many), audit({})))
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("...and 2 more.")
    expect(result.rationale).toContain("- p14 [low] <1")
    expect(result.rationale).not.toContain("p15")
  })

  it("FAILS for a critical advisory in development tooling, naming it and the rest", async () => {
    const result = await policy(
      envelope(
        audit({
          axios: { severity: "critical", range: "<1.6" },
          lodash: { severity: "high", range: "<4.17.21" },
          vitest: { severity: "low", range: "<3" },
        }),
        audit({}),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("1 critical advisory(ies)")
    expect(result.rationale).toContain("- axios [critical] <1.6")
    expect(result.rationale).not.toContain("- lodash")
    expect(result.rationale).toContain("Plus 2 lower-severity advisory(ies).")
  })

  it("only warns for a high advisory (a patched release is often not published yet)", async () => {
    const result = await policy(
      envelope(audit({ lodash: { severity: "high", range: "<4.17.21" } }), audit({})),
    )
    expect(result.outcome).toBe("warn")
  })

  it("does not mention lower-severity ones when every finding blocks", async () => {
    const result = await policy(
      envelope(audit({ axios: { severity: "critical", range: "<2" } }), audit({})),
    )
    expect(result.rationale).not.toContain("Plus")
  })

  it("fails when the audit itself could not run, or its output is not the expected envelope", async () => {
    expect(
      (await policy(makeJsonResult({ ok: false, error: "ENOTFOUND registry" }))).rationale,
    ).toBe("Dev dependency audit: ENOTFOUND registry")
    expect((await policy(makeResult({ status: "timed_out" }))).outcome).toBe("fail")
    expect(
      (await policy(makeResult({ output: { format: "json", success: false, error: "bad" } })))
        .outcome,
    ).toBe("fail")
  })
})

describe("scripts/audit-dev-deps.mjs", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-dev-audit-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const script = path.resolve(__dirname, "../scripts/audit-dev-deps.mjs")

  function run(npmBody: string | undefined) {
    const bin = path.join(dir, "bin")
    mkdirSync(bin)
    if (npmBody !== undefined) {
      const file = path.join(bin, "npm")
      writeFileSync(file, npmBody)
      chmodSync(file, 0o755)
    }
    const nodeOnly = path.join(dir, "node-only")
    mkdirSync(nodeOnly)
    return spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}` },
    })
  }

  it.skipIf(process.platform === "win32")(
    "audits the whole tree and the production tree and prints both",
    () => {
      const out = run(`#!/usr/bin/env node
const omit = process.argv.includes("--omit=dev")
process.stdout.write(JSON.stringify({ vulnerabilities: omit ? {} : { a: { severity: "low" } } }))
process.exit(1)
`)
      expect(out.status).toBe(0)
      expect(JSON.parse(out.stdout)).toEqual({
        ok: true,
        all: { vulnerabilities: { a: { severity: "low" } } },
        production: { vulnerabilities: {} },
      })
    },
  )

  it.skipIf(process.platform === "win32")(
    "reports output that is not JSON as an error, not a crash",
    () => {
      const out = run(`#!/usr/bin/env node
process.stdout.write("npm ERR! something")
`)
      expect(out.status).toBe(0)
      expect(JSON.parse(out.stdout)).toMatchObject({ ok: false })
      expect(JSON.parse(out.stdout).error).toContain("did not print JSON")
    },
  )
})
