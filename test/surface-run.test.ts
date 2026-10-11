import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { format } from "prettier"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Surface } from "../scripts/surface-contract/classify.js"
import {
  BASELINE_PATH,
  main,
  readSurfaceBaseline,
  runSurfaceCheck,
  runSurfaceUpdate,
  stableStringify,
} from "../scripts/surface-contract/run.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "surface-run-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}
const project = (version: string, help: string | null, schema: object | null = null): void => {
  write(
    "package.json",
    JSON.stringify({
      name: "@o/demo",
      version,
      ...(help === null ? {} : { bin: { demo: "cli.js" } }),
      ...(schema === null ? {} : { exports: { "./schema": "./s.json" } }),
    }),
  )
  if (help !== null) write("cli.js", "")
  if (schema !== null) write("s.json", JSON.stringify(schema))
}
const runBin = (help: string) => () => ({ exitCode: 0, stdout: help })
const changeset = (level: string): void =>
  write(".changeset/a.md", `---\n"@o/demo": ${level}\n---\n\nx\n`)
const baseline = (version: string, surface: Surface): void =>
  write(
    BASELINE_PATH,
    stableStringify({ packageName: "@o/demo", packageVersion: version, surface }),
  )
const surfaceWith = (help: string): Surface => ({
  cli: { demo: { exitCode: 0, help } },
  schemas: {},
  action: null,
})

describe("stableStringify", () => {
  it("sorts keys at every depth, keeps array order and ends with a newline", () => {
    expect(stableStringify({ b: [{ z: 1, a: 2 }], a: null })).toBe(
      '{\n  "a": null,\n  "b": [\n    {\n      "a": 2,\n      "z": 1\n    }\n  ]\n}\n',
    )
  })
})

describe("runSurfaceCheck: no baseline", () => {
  it("has nothing to guard for a package with no surface", async () => {
    project("0.1.0", null)
    expect(await runSurfaceCheck(root)).toMatchObject({
      status: "no-surface",
      changes: [],
      requiredLevel: "none",
    })
    expect(await readSurfaceBaseline(root)).toBeUndefined()
  })
  it("writes the first baseline locally, with the version it was taken at", async () => {
    project("0.3.0", "Usage --a")
    expect((await runSurfaceCheck(root, { runBin: runBin("Usage --a") })).status).toBe(
      "initial-baseline",
    )
    expect(await readSurfaceBaseline(root)).toEqual({
      packageName: "@o/demo",
      packageVersion: "0.3.0",
      surface: surfaceWith("Usage --a"),
    })
  })
  it("refuses to create the baseline in CI and reports it as unsatisfied", async () => {
    project("0.3.0", "Usage --a")
    const evidence = await runSurfaceCheck(root, { ci: true, runBin: runBin("Usage --a") })
    expect(evidence.status).toBe("missing-baseline")
    expect(evidence.changesets.satisfied).toBe(false)
    expect(await readSurfaceBaseline(root)).toBeUndefined()
  })
})

describe("runSurfaceCheck: a baseline whose version cannot be read", () => {
  it("refuses, rather than treating every version as a sufficient bump", async () => {
    project("0.3.0", "Usage")
    baseline("not-a-version", surfaceWith("Usage --a"))
    await expect(runSurfaceCheck(root, { runBin: runBin("Usage") })).rejects.toThrow(
      `${BASELINE_PATH} records an unparseable version "not-a-version"; restore it from git or regenerate it with \`internal-package-contract update-baseline\`.`,
    )
  })
})

describe("runSurfaceCheck: against a baseline", () => {
  it("is satisfied with no changeset when nothing changed", async () => {
    project("0.3.0", "Usage --a")
    baseline("0.3.0", surfaceWith("Usage --a"))
    const e = await runSurfaceCheck(root, { runBin: runBin("Usage --a") })
    expect(e).toMatchObject({
      status: "compared",
      changes: [],
      requiredLevel: "none",
      minimumRequiredVersion: "0.3.0",
      baselineVersion: "0.3.0",
    })
    expect(e.changesets.satisfied).toBe(true)
  })
  it("requires a minor for a removed flag below 1.0.0 and is unsatisfied without a changeset", async () => {
    project("0.3.0", "Usage")
    baseline("0.3.0", surfaceWith("Usage --a"))
    const e = await runSurfaceCheck(root, { runBin: runBin("Usage") })
    expect(e.requiredLevel).toBe("minor")
    expect(e.minimumRequiredVersion).toBe("0.4.0")
    expect(e.changesets).toEqual({ changesetCount: 0, declaredLevel: "none", satisfied: false })
  })
  it("is satisfied by a changeset of at least the required level", async () => {
    project("0.3.0", "Usage")
    baseline("0.3.0", surfaceWith("Usage --a"))
    changeset("minor")
    expect((await runSurfaceCheck(root, { runBin: runBin("Usage") })).changesets).toEqual({
      changesetCount: 1,
      declaredLevel: "minor",
      satisfied: true,
    })
    rmSync(path.join(root, ".changeset"), { recursive: true })
    changeset("patch")
    expect((await runSurfaceCheck(root, { runBin: runBin("Usage") })).changesets.satisfied).toBe(
      false,
    )
  })
  it("treats a version already bumped to the minimum as the declaration (the release pull request)", async () => {
    project("0.4.0", "Usage")
    baseline("0.3.0", surfaceWith("Usage --a"))
    expect((await runSurfaceCheck(root, { runBin: runBin("Usage") })).changesets.satisfied).toBe(
      true,
    )
  })
  it("asks for only a patch when a flag is added below 1.0.0, a minor from 1.0.0, a major for a break", async () => {
    project("0.3.0", "Usage --a --b")
    baseline("0.3.0", surfaceWith("Usage --a"))
    expect((await runSurfaceCheck(root, { runBin: runBin("Usage --a --b") })).requiredLevel).toBe(
      "patch",
    )
    project("1.2.0", "Usage --a --b")
    baseline("1.2.0", surfaceWith("Usage --a"))
    expect((await runSurfaceCheck(root, { runBin: runBin("Usage --a --b") })).requiredLevel).toBe(
      "minor",
    )
    expect((await runSurfaceCheck(root, { runBin: runBin("Usage") })).requiredLevel).toBe("major")
  })
  it("asks for a patch when only documentation changed", async () => {
    project("1.2.0", "x", { type: "object", description: "new" })
    baseline("1.2.0", {
      cli: { demo: { exitCode: 0, help: "x" } },
      schemas: { "./schema": { type: "object", description: "old" } },
      action: null,
    })
    expect((await runSurfaceCheck(root, { runBin: runBin("x") })).requiredLevel).toBe("patch")
  })
  it("fails clearly on a baseline that is not JSON", async () => {
    project("0.3.0", null)
    write(BASELINE_PATH, "{ nope")
    await expect(runSurfaceCheck(root)).rejects.toThrow(/baseline\.json is not valid JSON/)
  })
})

describe("runSurfaceUpdate", () => {
  it("does nothing for a package with no surface and no baseline", async () => {
    project("0.1.0", null)
    expect(await runSurfaceUpdate(root)).toBeUndefined()
  })
  it("bootstraps a baseline", async () => {
    project("0.1.0", "h")
    expect(await runSurfaceUpdate(root, { runBin: runBin("h") })).toEqual({
      status: "updated",
      message: `Surface baseline updated to version 0.1.0. Review ${BASELINE_PATH} and commit.`,
    })
    expect(readFileSync(path.join(root, BASELINE_PATH), "utf8")).toBe(
      stableStringify({
        packageName: "@o/demo",
        packageVersion: "0.1.0",
        surface: surfaceWith("h"),
      }),
    )
  })
  it("writes the baseline the way the repository's Prettier config formats JSON", async () => {
    write(".prettierrc.json", '{ "printWidth": 40, "tabWidth": 4 }')
    project("0.1.0", "h")
    await runSurfaceUpdate(root, { runBin: runBin("h") })
    const text = readFileSync(path.join(root, BASELINE_PATH), "utf8")
    expect(text).toBe(await format(text, { parser: "json", printWidth: 40, tabWidth: 4 }))
    expect(text).toContain('\n    "packageName"')
  })
  it("moves the baseline forward on a version bump", async () => {
    project("0.2.0", "h2")
    baseline("0.1.0", surfaceWith("h"))
    expect((await runSurfaceUpdate(root, { runBin: runBin("h2") }))?.status).toBe("updated")
    expect((await readSurfaceBaseline(root))?.packageVersion).toBe("0.2.0")
  })
  it("is current when the version and contents match", async () => {
    project("0.2.0", "h")
    baseline("0.2.0", surfaceWith("h"))
    expect((await runSurfaceUpdate(root, { runBin: runBin("h") }))?.status).toBe("current")
  })
  it("refreshes contents at the same version and says so", async () => {
    project("0.2.0", "changed")
    baseline("0.2.0", surfaceWith("h"))
    const outcome = await runSurfaceUpdate(root, { runBin: runBin("changed") })
    expect(outcome).toEqual({
      status: "updated",
      message: `Surface baseline contents refreshed at version 0.2.0. Review ${BASELINE_PATH} and commit.`,
    })
  })
  it("refuses to move the baseline backwards", async () => {
    project("0.1.0", "h")
    baseline("0.2.0", surfaceWith("h"))
    const outcome = await runSurfaceUpdate(root, { runBin: runBin("h") })
    expect(outcome?.status).toBe("refused")
    expect(outcome?.message).toContain("older than the committed surface baseline's 0.2.0")
    expect((await readSurfaceBaseline(root))?.packageVersion).toBe("0.2.0")
  })
  it("refuses an unparseable package version or baseline version", async () => {
    project("next", "h")
    expect((await runSurfaceUpdate(root, { runBin: runBin("h") }))?.message).toContain(
      'could not parse package.json\'s version "next"',
    )
    project("0.1.0", "h")
    baseline("junk", surfaceWith("h"))
    expect((await runSurfaceUpdate(root, { runBin: runBin("h") }))?.message).toContain(
      'unparseable version "junk"',
    )
  })
})

describe("runSurfaceCheck (exact evidence)", () => {
  it("reports a surface-free package with its changesets counted and satisfied", async () => {
    project("0.1.0", null)
    changeset("minor")
    expect(await runSurfaceCheck(root)).toEqual({
      currentVersion: "0.1.0",
      status: "no-surface",
      changes: [],
      requiredLevel: "none",
      minimumRequiredVersion: undefined,
      baselineVersion: undefined,
      changesets: { changesetCount: 1, declaredLevel: "minor", satisfied: true },
    })
  })
  it("asks for a minor, not a patch, when one change widens and another does not, from 1.0.0", async () => {
    project("1.2.0", "Usage --a --b", { type: "object", description: "new" })
    baseline("1.2.0", {
      cli: { demo: { exitCode: 0, help: "Usage --a" } },
      schemas: { "./schema": { type: "object", description: "old" } },
      action: null,
    })
    const e = await runSurfaceCheck(root, { runBin: runBin("Usage --a --b") })
    expect(e.changes.map((c) => [c.kind, c.widens])).toEqual([
      ["cli-flag-added", true],
      ["schema-docs-changed", false],
    ])
    expect(e.requiredLevel).toBe("minor")
  })
  it("treats an unparseable package version as not pre-1.0 and not bumped", async () => {
    project("next", "Usage")
    baseline("0.3.0", surfaceWith("Usage --a"))
    const e = await runSurfaceCheck(root, { runBin: runBin("Usage") })
    expect(e.requiredLevel).toBe("major")
    expect(e.changesets.satisfied).toBe(false)
  })
})

describe("runSurfaceCheck (mixed impact)", () => {
  it("needs a major when one change is breaking and another is compatible, from 1.0.0", async () => {
    project("1.2.0", "Usage --b", { type: "object", description: "new" })
    baseline("1.2.0", {
      cli: { demo: { exitCode: 0, help: "Usage --a --b" } },
      schemas: { "./schema": { type: "object", description: "old" } },
      action: null,
    })
    expect((await runSurfaceCheck(root, { runBin: runBin("Usage --b") })).requiredLevel).toBe(
      "major",
    )
  })
})

describe("runSurfaceUpdate (exact outcomes)", () => {
  it("moves the baseline forward when only the version changed", async () => {
    project("0.2.0", "h")
    baseline("0.1.0", surfaceWith("h"))
    const outcome = await runSurfaceUpdate(root, { runBin: runBin("h") })
    expect(outcome).toEqual({
      status: "updated",
      message: `Surface baseline updated to version 0.2.0. Review ${BASELINE_PATH} and commit.`,
    })
    expect((await readSurfaceBaseline(root))?.packageVersion).toBe("0.2.0")
  })
  it("words the refusals and the no-op exactly", async () => {
    project("next", "h")
    expect(await runSurfaceUpdate(root, { runBin: runBin("h") })).toEqual({
      status: "refused",
      message:
        'Refusing to update: could not parse package.json\'s version "next" as major.minor.patch.',
    })
    project("0.1.0", "h")
    baseline("junk", surfaceWith("h"))
    expect(await runSurfaceUpdate(root, { runBin: runBin("h") })).toEqual({
      status: "refused",
      message:
        'Refusing to update: the committed surface baseline records an unparseable version "junk".',
    })
    project("0.1.0", "h")
    baseline("0.2.0", surfaceWith("h"))
    expect(await runSurfaceUpdate(root, { runBin: runBin("h") })).toEqual({
      status: "refused",
      message:
        "Refusing to update: package.json declares 0.1.0, older than the committed surface baseline's 0.2.0.",
    })
    project("0.2.0", "h")
    baseline("0.2.0", surfaceWith("h"))
    expect(await runSurfaceUpdate(root, { runBin: runBin("h") })).toEqual({
      status: "current",
      message:
        "Surface baseline is already at version 0.2.0 with matching contents; nothing to do.",
    })
  })
})

describe("main", () => {
  it("creates the first baseline when CI is not set", async () => {
    project("0.3.0", "Usage --a")
    let out = ""
    await main(root, {}, (text) => (out += text))
    expect(JSON.parse(out).status).toBe("initial-baseline")
    expect(await readSurfaceBaseline(root)).toBeDefined()
  })
  it("treats CI set to anything but true as not CI", async () => {
    project("0.3.0", "Usage --a")
    let out = ""
    await main(root, { CI: "false" }, (text) => (out += text))
    expect(JSON.parse(out).status).toBe("initial-baseline")
  })
  it("prints only the evidence as JSON, and passes CI=true through", async () => {
    project("0.3.0", "Usage --a")
    let out = ""
    await main(root, { CI: "true" }, (text) => (out += text))
    expect(JSON.parse(out).status).toBe("missing-baseline")
    expect(out.endsWith("}")).toBe(true)
  })
})
