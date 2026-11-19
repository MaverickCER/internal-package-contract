import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { sbom } from "repo-contract/presets"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OPTIONAL_CHECKS, optionalChecks } from "../checks/optional.js"
import { SBOM_FIX, sbomCheck } from "../checks/sbom.js"
import { DOCUMENTATION } from "../scripts/changed.mjs"
import * as tools from "../scripts/package-tools/index.mjs"
import * as sbomTool from "../scripts/package-tools/sbom.mjs"
import { makeContext, makeJsonResult } from "./support.js"

/** A lockfile with one production dependency and one dev dependency. */
const LOCK = {
  name: "p",
  version: "1.0.0",
  lockfileVersion: 3,
  packages: {
    "": {
      name: "p",
      version: "1.0.0",
      dependencies: { a: "^1.0.0" },
      devDependencies: { b: "^1.0.0" },
    },
    "node_modules/a": { version: "1.0.0", license: "MIT" },
    "node_modules/b": { version: "2.0.0", dev: true, license: "ISC" },
  },
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sbom-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const sink = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}
const writeLock = (lock: unknown = LOCK) =>
  writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock))
const readDocument = (file: string) =>
  JSON.parse(readFileSync(path.join(dir, file), "utf8")) as {
    components: { name: string }[]
  }

/** Runs the check's own command in `dir` and judges what it printed. */
async function judge() {
  const [command, ...args] = sbomCheck().run as readonly string[]
  const child = spawnSync(command ?? "node", args, { cwd: dir, encoding: "utf8" })
  return sbomCheck().policy(makeContext(makeJsonResult(JSON.parse(child.stdout) as unknown)))
}

describe("sbomCheck", () => {
  it("runs repo-contract's sbom preset in check mode, naming `tool sbom` as the fix", () => {
    const check = sbomCheck()
    expect(check.run).toEqual(sbom({ fix: SBOM_FIX }).run)
    expect((check.run as readonly string[]).at(-1)).toBe("check")
    expect(check.output).toEqual({ format: "json" })
    expect(SBOM_FIX).toBe("internal-package-contract tool sbom")
  })

  it("fails before the documents exist, naming the tool that writes them", async () => {
    writeLock()
    expect(await judge()).toEqual({
      outcome: "fail",
      rationale:
        "Sbom: SBOM(s) out of date with package-lock.json:\n- docs/sbom.cdx.json: missing (2 components)\n- docs/sbom.production.cdx.json: missing (1 components)\nRegenerate them: internal-package-contract tool sbom",
    })
  })

  it("passes once `tool sbom` has written them, and fails again when the lockfile moves", async () => {
    writeLock()
    expect(await sbomTool.run([], dir, sink().io)).toBe(0)
    expect(await judge()).toEqual({
      outcome: "pass",
      rationale:
        "Sbom: CycloneDX 1.6 SBOM(s) match package-lock.json:\n- docs/sbom.cdx.json: current (2 components)\n- docs/sbom.production.cdx.json: current (1 components)",
    })
    const moved = structuredClone(LOCK)
    moved.packages["node_modules/a"].version = "1.0.1"
    writeLock(moved)
    expect((await judge()).outcome).toBe("fail")
  })

  it("is optional, waits on nothing, and is turned on by naming it in package.json", () => {
    expect(OPTIONAL_CHECKS["Sbom"]?.dependsOn).toEqual([])
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ "internal-package-contract": { checks: ["Sbom"] } }),
    )
    const checks = optionalChecks(dir)
    expect(Object.keys(checks)).toEqual(["Sbom"])
    expect(checks["Sbom"]?.dependsOn).toEqual([])
    expect(checks["Sbom"]?.run).toEqual(sbomCheck().run)
  })

  it("runs under --changed when only documentation changed, since the documents live in docs/", () => {
    expect(DOCUMENTATION).toContain("Sbom")
  })
})

describe("tool sbom", () => {
  it("is listed by the tool dispatcher, with what it does", async () => {
    const s = sink()
    expect(await tools.run([], dir, s.io)).toBe(2)
    expect(s.err.join("")).toContain(
      "  sbom                 write the CycloneDX 1.6 SBOMs in docs/ from package-lock.json\n",
    )
  })

  it("writes the full and production documents and says what it wrote", async () => {
    writeLock()
    const s = sink()
    expect(await tools.run(["sbom"], dir, s.io)).toBe(0)
    expect(s.out.join("")).toBe(
      "[sbom] wrote docs/sbom.cdx.json (2 components)\n[sbom] wrote docs/sbom.production.cdx.json (1 components)\n",
    )
    expect(s.err).toEqual([])
    expect(readDocument("docs/sbom.cdx.json").components.map((c) => c.name)).toEqual(["a", "b"])
    expect(readDocument("docs/sbom.production.cdx.json").components.map((c) => c.name)).toEqual([
      "a",
    ])
  })

  it("fails with the generator's error when there is no usable lockfile", async () => {
    const s = sink()
    expect(await sbomTool.run([], dir, s.io)).toBe(1)
    expect(s.err.join("")).toBe('[sbom] Cannot read the lockfile "package-lock.json".\n')
    expect(s.out).toEqual([])
  })

  it("takes no arguments", async () => {
    writeLock()
    const s = sink()
    expect(await sbomTool.run(["--check", "now"], dir, s.io)).toBe(2)
    expect(s.err.join("")).toBe("[sbom] takes no arguments; got: --check now\n")
  })

  it("refuses to write through a symlinked document, leaving its target unchanged", async () => {
    writeLock()
    const outside = mkdtempSync(path.join(tmpdir(), "sbom-outside-"))
    try {
      writeFileSync(path.join(outside, "target.json"), "keep")
      mkdirSync(path.join(dir, "docs"))
      symlinkSync(path.join(outside, "target.json"), path.join(dir, "docs", "sbom.cdx.json"))
      expect(await sbomTool.run([], dir, sink().io)).toBe(1)
      expect(readFileSync(path.join(outside, "target.json"), "utf8")).toBe("keep")
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("refuses to write into a symlinked docs/ folder, leaving it unchanged", async () => {
    writeLock()
    const outside = mkdtempSync(path.join(tmpdir(), "sbom-outside-"))
    try {
      writeFileSync(path.join(outside, "sbom.cdx.json"), "keep")
      symlinkSync(outside, path.join(dir, "docs"))
      expect(await sbomTool.run([], dir, sink().io)).toBe(1)
      expect(readFileSync(path.join(outside, "sbom.cdx.json"), "utf8")).toBe("keep")
      expect(readdirSync(outside)).toEqual(["sbom.cdx.json"])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("fails when the generator prints no report", async () => {
    const s = sink()
    const failing = () => ({ stdout: Buffer.from(""), stderr: Buffer.from("boom\n") })
    expect(await sbomTool.run([], dir, s.io, failing)).toBe(1)
    expect(s.err.join("")).toBe("[sbom] the SBOM generator printed no report: boom\n")
  })
})
