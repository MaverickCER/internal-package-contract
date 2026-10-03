import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runApiContractCheck } from "../scripts/api-contract/check.js"
import { detectSchemaVersionDrift } from "../scripts/api-contract/schema-version-consistency.js"
import {
  summarizeChanges,
  summarizeLowerTierChanges,
} from "../scripts/api-contract/summarize-changes.js"
import type { NormalizedMember } from "../scripts/api-contract/model-normalizer.js"

/**
 * A table of source edits, each classified against a committed baseline by the real engine. Every row
 * names the kind of change the diff must contain and the impact it must have.
 */
const tsc = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
)

const BASE = `/** @public */
export function pick(value: string): string
/** @public */
export function pick(value: number): number
/** @public */
export function pick(value: string | number): string | number {
  return value
}
/** @public */
export function identity<T>(value: T): T {
  return value
}
/** @public */
export interface Shape {
  readonly id: string
  size: number
}
/** @public */
export interface Circle extends Shape {
  radius: number
}
/** @public */
export class Box<T> {
  constructor(public value: T) {}
}
/** @public */
export enum Level {
  Low = 1,
  High = 2,
}
/** @public */
export type Handler = (event: string) => void
/** @public */
export const LIMIT: number = 10
/**
 * @public
 * @deprecated use identity
 */
export function legacy(): void {}
/** @beta */
export function experimental(): void {}
/** @public */
export interface Versioned {
  version: 1
  name: string
}
`

let root: string
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })
const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}
const source = (text: string) => {
  write("src/index.ts", text)
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "ignore" })
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-api-scen-"))
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "t")
  write("package.json", JSON.stringify({ name: "fx", version: "1.2.0", type: "module" }))
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
  write(".gitignore", "dist/\n.repo-contract/api-contract/*/current*\n")
  source(BASE)
  await runApiContractCheck(root, "public")
  git("add", "-A")
  git("commit", "-q", "-m", "baseline")
}, 120_000)

afterAll(() => rmSync(root, { recursive: true, force: true }))

interface Row {
  name: string
  edit: (text: string) => string
  kinds: string[]
  impact: "breaking" | "compatible" | "unknown" | "unchanged"
}

const rows: Row[] = [
  {
    name: "removing an overload",
    edit: (t) => t.replace("/** @public */\nexport function pick(value: number): number\n", ""),
    kinds: ["overload-removed"],
    impact: "breaking",
  },
  {
    name: "adding an overload",
    edit: (t) =>
      t
        .replace(
          "/** @public */\nexport function pick(value: number): number\n",
          "/** @public */\nexport function pick(value: number): number\n/** @public */\nexport function pick(value: boolean): boolean\n",
        )
        .replace(
          "pick(value: string | number): string | number",
          "pick(value: string | number | boolean): string | number | boolean",
        ),
    kinds: ["overload-added"],
    impact: "compatible",
  },
  {
    name: "adding a type parameter",
    edit: (t) => t.replace("identity<T>(value: T): T", "identity<T, U = T>(value: T): T"),
    kinds: ["generic-parameter-changed"],
    impact: "unknown",
  },
  {
    name: "a new required property on an interface",
    edit: (t) => t.replace("  size: number\n}", "  size: number\n  color: string\n}"),
    kinds: ["property-added"],
    impact: "breaking",
  },
  {
    name: "removing a property",
    edit: (t) => t.replace("  size: number\n}", "}"),
    kinds: ["property-removed"],
    impact: "breaking",
  },
  {
    name: "making a property readonly",
    edit: (t) => t.replace("  size: number\n}", "  readonly size: number\n}"),
    kinds: ["property-readonly-changed"],
    impact: "compatible",
  },
  {
    name: "changing a property type",
    edit: (t) => t.replace("  size: number\n}", "  size: string\n}"),
    kinds: ["property-type-changed"],
    impact: "breaking",
  },
  {
    name: "changing what an interface extends",
    edit: (t) => t.replace("export interface Circle extends Shape {", "export interface Circle {"),
    kinds: ["heritage-changed"],
    impact: "unknown",
  },
  {
    name: "adding an enum member",
    edit: (t) => t.replace("  High = 2,\n", "  High = 2,\n  Max = 3,\n"),
    kinds: ["enum-member-added"],
    impact: "compatible",
  },
  {
    name: "changing an enum member's value",
    edit: (t) => t.replace("High = 2", "High = 5"),
    kinds: ["enum-member-changed"],
    impact: "breaking",
  },
  {
    name: "changing a type alias",
    edit: (t) => t.replace("(event: string) => void", "(event: number) => void"),
    kinds: ["type-alias-changed"],
    impact: "breaking",
  },
  {
    name: "changing an exported variable's type",
    edit: (t) => t.replace("LIMIT: number = 10", 'LIMIT: string = "10"'),
    kinds: ["property-type-changed"],
    impact: "breaking",
  },
  {
    name: "removing an export",
    edit: (t) => t.replace("/** @public */\nexport const LIMIT: number = 10\n", ""),
    kinds: ["export-removed"],
    impact: "breaking",
  },
  {
    name: "deprecating an export",
    edit: (t) =>
      t.replace(
        "/** @public */\nexport const LIMIT: number = 10",
        "/**\n * @public\n * @deprecated use something else\n */\nexport const LIMIT: number = 10",
      ),
    kinds: ["deprecation-changed"],
    impact: "compatible",
  },
  {
    name: "promoting a beta export to public",
    edit: (t) => t.replace("/** @beta */", "/** @public */"),
    kinds: ["export-added"],
    impact: "compatible",
  },
  {
    name: "a documentation-only edit (not part of the contract)",
    edit: (t) =>
      t.replace(
        "/** @public */\nexport function identity",
        "/**\n * Returns its argument.\n * @public\n */\nexport function identity",
      ),
    kinds: [],
    impact: "unchanged",
  },
  {
    name: "changing a schema's shape without bumping its version literal",
    edit: (t) =>
      t.replace("  version: 1\n  name: string", "  version: 1\n  name: string\n  extra: number"),
    kinds: ["schema-version-literal-stale"],
    impact: "breaking",
  },
  {
    name: "changing a schema's shape and bumping its version literal",
    edit: (t) =>
      t.replace("  version: 1\n  name: string", "  version: 2\n  name: string\n  extra: number"),
    kinds: ["property-added"],
    impact: "breaking",
  },
]

describe("the API-contract engine classifies each kind of change", { timeout: 180_000 }, () => {
  it("sees no change in the unedited source", async () => {
    source(BASE)
    const evidence = await runApiContractCheck(root, "public")
    expect(evidence.targets[0]).toMatchObject({ impact: "unchanged", diff: [] })
  })

  for (const row of rows) {
    it(row.name, async () => {
      source(row.edit(BASE))
      const evidence = await runApiContractCheck(root, "public")
      const target = evidence.targets[0]
      expect(
        target?.diff.map((change) => change.kind),
        JSON.stringify(target?.diff),
      ).toEqual(expect.arrayContaining(row.kinds))
      expect(target?.impact).toBe(row.impact)
      // 1.2.0 is past 1.0.0, so the levels are not deflated
      if (row.impact === "breaking") expect(target?.requiredLevel).toBe("major")
      if (row.impact === "unchanged") expect(target?.requiredLevel).toBe("none")
      if (row.impact === "unknown") expect(target?.requiredLevel).toBeUndefined()
    })
  }

  it("keeps changes to a beta export out of the public diff, and reports them as informational", async () => {
    source(
      BASE.replace(
        "export function experimental(): void {}",
        "export function experimental(extra: string): void { void extra }",
      ),
    )
    const evidence = await runApiContractCheck(root, "public")
    expect(evidence.targets[0]?.impact).toBe("unchanged")
    expect(evidence.targets[0]?.lowerTierDiff.length).toBeGreaterThan(0)
    const beta = await runApiContractCheck(root, "beta")
    expect(beta.targets[0]?.impact).toBe("breaking")
  })
})

describe("detectSchemaVersionDrift() and the summaries, directly", () => {
  const member = (
    over: Partial<NormalizedMember> & { canonicalReference: string },
  ): NormalizedMember => ({
    scopedName: over.name ?? "m",
    kind: "PropertySignature",
    isTopLevelExport: false,
    releaseTag: "public",
    isDeprecated: false,
    ...over,
  })
  const iface = member({
    canonicalReference: "p!S:interface",
    name: "S",
    kind: "Interface",
    isTopLevelExport: true,
  })
  const version = (text: string) =>
    member({
      canonicalReference: "p!S#version:member",
      parentCanonicalReference: "p!S:interface",
      name: "version",
      propertyTypeExcerptText: text,
    })
  const other = (name: string) =>
    member({
      canonicalReference: `p!S#${name}:member`,
      parentCanonicalReference: "p!S:interface",
      name,
      propertyTypeExcerptText: "string",
    })
  const mapOf = (...items: NormalizedMember[]) =>
    new Map(items.map((i) => [i.canonicalReference, i]))

  it("flags an interface that changed shape under an unchanged version literal, naming the file", () => {
    const base = mapOf(
      { ...iface, fileUrlPath: "src/s.ts" } as NormalizedMember,
      version("1"),
      other("a"),
    )
    const cur = mapOf(
      { ...iface, fileUrlPath: "src/s.ts" } as NormalizedMember,
      version("1"),
      other("a"),
      other("b"),
    )
    const [change] = detectSchemaVersionDrift(base, cur)
    expect(change).toMatchObject({
      kind: "schema-version-literal-stale",
      compatibility: "breaking",
    })
    expect(change?.explanation).toContain(
      "in src/s.ts changed shape (1 member(s) added/removed/changed)",
    )
    const removed = detectSchemaVersionDrift(
      mapOf(iface, version("1"), other("a"), other("b")),
      mapOf(iface, version("1"), other("a")),
    )
    expect(removed).toHaveLength(1)
    const retyped = detectSchemaVersionDrift(
      mapOf(iface, version("1"), other("a")),
      mapOf(iface, version("1"), { ...other("a"), propertyTypeExcerptText: "number" }),
    )
    expect(retyped).toHaveLength(1)
  })

  it("is silent when the literal moved, nothing else changed, only a file moved, or the shape is not a versioned interface", () => {
    expect(
      detectSchemaVersionDrift(
        mapOf(iface, version("1"), other("a")),
        mapOf(iface, version("2"), other("a"), other("b")),
      ),
    ).toEqual([])
    expect(
      detectSchemaVersionDrift(
        mapOf(iface, version("1"), other("a")),
        mapOf(iface, version("1"), other("a")),
      ),
    ).toEqual([])
    expect(
      detectSchemaVersionDrift(
        mapOf(iface, version("1"), { ...other("a"), fileUrlPath: "x.ts" }),
        mapOf(iface, version("1"), { ...other("a"), fileUrlPath: "y.ts" }),
      ),
    ).toEqual([])
    expect(
      detectSchemaVersionDrift(mapOf(iface, other("a")), mapOf(iface, other("a"), other("b"))),
    ).toEqual([])
    expect(
      detectSchemaVersionDrift(
        mapOf(iface, version("string"), other("a")),
        mapOf(iface, version("string"), other("a"), other("b")),
      ),
    ).toEqual([])
    const notInterface = { ...iface, kind: "Class" }
    expect(
      detectSchemaVersionDrift(
        mapOf(notInterface, version("1")),
        mapOf(notInterface, version("1"), other("a")),
      ),
    ).toEqual([])
    expect(detectSchemaVersionDrift(mapOf(), mapOf(iface))).toEqual([])
    expect(detectSchemaVersionDrift(mapOf({ ...iface, kind: "TypeAlias" }), mapOf(iface))).toEqual(
      [],
    )
  })

  it("summarizes: the initial baseline, no change, a change list, and an unclassifiable one", () => {
    const change = {
      id: "a#export-added",
      path: "a",
      kind: "export-added" as const,
      compatibility: "compatible" as const,
      explanation: "Added a.",
    }
    expect(summarizeChanges([], "unchanged", true)).toContain("initial contract baseline")
    expect(summarizeChanges([], "unchanged", false)).toBe("No public API changes detected.")
    expect(summarizeChanges([change], "compatible", false)).toBe(
      "1 public contract change(s) detected:\n- Added a.",
    )
    expect(summarizeChanges([change], "unknown", false)).toContain(
      "could not be classified deterministically",
    )
    expect(summarizeLowerTierChanges([])).toBeUndefined()
    expect(summarizeLowerTierChanges([change])).toContain(
      "1 non-public contract change(s) also detected (informational only",
    )
  })
})
