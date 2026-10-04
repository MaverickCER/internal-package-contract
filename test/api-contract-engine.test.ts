import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runApiContractCheck } from "../scripts/api-contract/check.js"
import { runUpdateBaseline } from "../scripts/api-contract/update-baseline.js"

/**
 * The semver engine end to end, on a real scratch package: TypeScript emits declarations, API
 * Extractor extracts the contract, the baseline is committed to git and read back from `HEAD`, and each
 * change to the source is classified against it. This is the code that decides what bump every
 * package's release needs, so it is exercised through its real path rather than through stubs.
 */
const tsc = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
)

let root: string
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })
const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}
const build = () =>
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "ignore" })
const source = (text: string) => {
  write("src/index.ts", text)
  build()
}
const setVersion = (version: string) =>
  write(
    "package.json",
    JSON.stringify({
      name: "fx",
      version,
      type: "module",
      exports: { ".": { import: { types: "./dist/index.d.ts", default: "./dist/index.js" } } },
    }),
  )
const commitAll = (message: string) => {
  git("add", "-A")
  git("commit", "-q", "-m", message)
}

const V1 = `/** @public */
export function add(a: number, b: number): number {
  return a + b
}
/** @public */
export interface Options {
  name: string
  verbose?: boolean
}
/** @public */
export enum Mode {
  Fast = "fast",
  Slow = "slow",
}
/** @public */
export class Counter {
  count = 0
  /** @public */
  bump(by: number): number {
    this.count += by
    return this.count
  }
}
/** @public */
export type Id = string
`

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-api-engine-"))
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "t")
  setVersion("0.1.0")
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: "dist/.dts",
        rootDir: "src",
        skipLibCheck: true,
      },
      include: ["src"],
    }),
  )
  write("typedoc.json", JSON.stringify({ entryPoints: ["src/index.ts"] }))
  write(".gitignore", "dist/\nnode_modules/\n.repo-contract/api-contract/*/current*\n")
  source(V1)
}, 120_000)

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("the API-contract engine on a real package", { timeout: 180_000 }, () => {
  it("bootstraps the first baseline, then sees no change", async () => {
    const first = await runApiContractCheck(root, "public")
    expect(first.targets[0]).toMatchObject({ target: "index", initialBaseline: true, diff: [] })
    expect(first.targets[0]?.minimumRequiredVersion).toBe("0.1.0")
    commitAll("baseline")
    const again = await runApiContractCheck(root, "public")
    expect(again.targets[0]).toMatchObject({
      initialBaseline: false,
      impact: "unchanged",
      requiredLevel: "none",
    })
    expect(again.requiredLevel).toBe("none")
    expect(again.changesets).toEqual({ changesetCount: 0, declaredLevel: "none", satisfied: true })
    expect(again.currentVersion).toBe("0.1.0")
  })

  it("classifies a widening of the surface as compatible (patch below 1.0.0, minor from 1.0.0)", async () => {
    source(
      V1 +
        "/** @public */\nexport function subtract(a: number, b: number): number {\n  return a - b\n}\n",
    )
    const evidence = await runApiContractCheck(root, "public")
    expect(evidence.targets[0]?.impact).toBe("compatible")
    expect(evidence.targets[0]?.diff.map((c) => c.kind)).toContain("export-added")
    expect(evidence.requiredLevel).toBe("patch")
    setVersion("1.0.0")
    expect((await runApiContractCheck(root, "public")).requiredLevel).toBe("minor")
    setVersion("0.1.0")
  })

  it("classifies breaking changes: removal, a narrowed parameter, a required property, a removed enum member", async () => {
    source(
      V1.replace(
        "export function add(a: number, b: number): number {\n  return a + b\n}",
        "export function add(a: number): number {\n  return a\n}",
      ),
    )
    let evidence = await runApiContractCheck(root, "public")
    expect(evidence.targets[0]?.impact).toBe("breaking")
    expect(evidence.targets[0]?.diff.map((c) => c.kind)).toContain("parameter-removed")
    // below 1.0.0 a breaking change needs only a minor; from 1.0.0 it needs a major
    expect(evidence.requiredLevel).toBe("minor")
    setVersion("2.3.0")
    evidence = await runApiContractCheck(root, "public")
    expect(evidence.requiredLevel).toBe("major")
    // the minimum version is the committed baseline's (0.1.0) bumped at the required level
    expect(evidence.minimumRequiredVersion).toBe("1.0.0")
    setVersion("0.1.0")

    source(V1.replace("verbose?: boolean", "verbose: boolean"))
    expect(
      (await runApiContractCheck(root, "public")).targets[0]?.diff.map((c) => c.kind),
    ).toContain("property-optionality-changed")

    source(V1.replace('  Slow = "slow",\n', ""))
    expect(
      (await runApiContractCheck(root, "public")).targets[0]?.diff.map((c) => c.kind),
    ).toContain("enum-member-removed")

    source(V1.replace("export type Id = string", "export type Id = number"))
    const alias = await runApiContractCheck(root, "public")
    expect(alias.targets[0]?.impact).not.toBe("unchanged")
    expect(alias.targets[0]?.diff.map((c) => c.kind)).toContain("type-alias-changed")

    source(
      V1.replace(
        "export class Counter {",
        "export class Counter {\n  constructor(readonly start: number) {}\n",
      ),
    )
    expect((await runApiContractCheck(root, "public")).targets[0]?.diff.length).toBeGreaterThan(0)

    source(
      V1.replace("bump(by: number): number {", "bump(by: number, extra: number): number {").replace(
        "this.count += by",
        "this.count += by + extra",
      ),
    )
    const added = await runApiContractCheck(root, "public")
    expect(added.targets[0]?.diff.map((c) => c.kind)).toContain("parameter-added")
    expect(added.targets[0]?.impact).toBe("breaking")
  })

  it("classifies a return-type change by assignability, and a pure type widening as compatible", async () => {
    source(
      V1.replace("bump(by: number): number {", "bump(by: number): string {").replace(
        "    this.count += by\n    return this.count",
        "    return String(by)",
      ),
    )
    const narrowed = await runApiContractCheck(root, "public")
    expect(narrowed.targets[0]?.diff.map((c) => c.kind)).toContain("return-type-changed")
    expect(narrowed.targets[0]?.impact).toBe("breaking")

    source(
      V1.replace(
        "export function add(a: number, b: number): number {",
        "export function add(a: number | bigint, b: number): number {",
      ).replace("return a + b", "return Number(a) + b"),
    )
    const widened = await runApiContractCheck(root, "public")
    expect(widened.targets[0]?.diff.map((c) => c.kind)).toContain("parameter-type-changed")
    expect(widened.targets[0]?.impact).toBe("compatible")
  })

  it("compares what the changesets declare with what the diff requires", async () => {
    source(
      V1.replace(
        "export function add(a: number, b: number): number {\n  return a + b\n}",
        "export function add(a: number): number {\n  return a\n}",
      ),
    )
    write(".changeset/small.md", '---\n"fx": patch\n---\n\nTiny.\n')
    const under = await runApiContractCheck(root, "public")
    expect(under.changesets).toEqual({
      changesetCount: 1,
      declaredLevel: "patch",
      satisfied: false,
    })
    write(".changeset/big.md", '---\n"fx": major\n---\n\nBreaking.\n')
    const over = await runApiContractCheck(root, "public")
    expect(over.changesets).toEqual({ changesetCount: 2, declaredLevel: "major", satisfied: true })
    // a human-authored major satisfies any requirement, which is how 0.x crosses to 1.0.0
    expect(over.requiredLevel).toBe("minor")
    rmSync(path.join(root, ".changeset"), { recursive: true, force: true })
  })

  it("refreshes the baseline only through update-baseline, with its guardrails", async () => {
    source(V1 + "/** @public */\nexport const VERSION = 1\n")
    const refused = await runUpdateBaseline(root)
    // same version, contents differ: refreshed in place
    expect(refused[0]).toMatchObject({ target: "index", status: "updated" })
    expect(refused[0]?.message).toContain("without a version bump")
    commitAll("api change")
    expect((await runUpdateBaseline(root))[0]).toMatchObject({ status: "current" })
    setVersion("0.0.1")
    expect((await runUpdateBaseline(root))[0]).toMatchObject({ status: "refused" })
    setVersion("0.2.0")
    expect((await runUpdateBaseline(root))[0]).toMatchObject({ status: "updated" })
    setVersion("not-a-version")
    expect((await runUpdateBaseline(root))[0]).toMatchObject({ status: "refused" })
    setVersion("0.2.0")
  })
})
