import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { benchmarkCoverageCheck } from "../checks/benchmark-coverage.js"
import { MIN_REASON, parseAccounting } from "../scripts/benchmark/coverage/accounting.mjs"
import { coverageFindings } from "../scripts/benchmark/coverage/findings.mjs"
import {
  API_CONTRACT_DIR,
  readBaselines,
  scanCoverage,
} from "../scripts/benchmark/coverage/scan.mjs"
import {
  keysOf,
  literalKeys,
  parametersOf,
  signaturesOf,
} from "../scripts/benchmark/coverage/signatures.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

// ---- an API baseline, as api-extractor writes it ----

const tokens = (...texts: string[]) => texts.map((text) => ({ kind: "Content", text }))
const property = (name: string) => ({
  kind: "PropertySignature",
  name,
  excerptTokens: tokens(`${name}: string;`),
})
const iface = (name: string, keys: string[], extendsTypes: string[] = []) => ({
  kind: "Interface",
  name,
  excerptTokens: tokens(`export interface ${name} `, ...extendsTypes),
  extendsTokenRanges: extendsTypes.map((_, index) => ({
    startIndex: 1 + index,
    endIndex: 2 + index,
  })),
  releaseTag: "Public",
  members: keys.map(property),
})
const alias = (name: string, type: string) => ({
  kind: "TypeAlias",
  name,
  excerptTokens: tokens(`export type ${name} = `, type),
  typeTokenRange: { startIndex: 1, endIndex: 2 },
  releaseTag: "Public",
})
/** A function as api-extractor writes it: a header token, then `name: ` and the type's tokens for each parameter. */
const fn = (name: string, parameters: [string, string | string[]][], releaseTag = "Public") => {
  const excerptTokens = [{ kind: "Content", text: `export declare function ${name}(` }]
  const ranges = parameters.map(([parameterName, type]) => {
    excerptTokens.push({ kind: "Content", text: `${parameterName}: ` })
    const startIndex = excerptTokens.length
    for (const text of typeof type === "string" ? [type] : type)
      excerptTokens.push({ kind: "Content", text })
    excerptTokens.push({ kind: "Content", text: ", " })
    return { startIndex, endIndex: excerptTokens.length - 1 }
  })
  return {
    kind: "Function",
    name,
    releaseTag,
    excerptTokens,
    parameters: parameters.map(([parameterName], index) => ({
      parameterName,
      parameterTypeTokenRange: ranges[index],
    })),
  }
}
const pkg = (...members: object[]) => ({
  kind: "Package",
  members: [{ kind: "EntryPoint", members }],
})

describe("literalKeys", () => {
  it("reads the top-level keys of an object type, however it is written", () => {
    expect(literalKeys("{ a: string; b?: number, readonly c: boolean }")).toEqual(["a", "b", "c"])
    expect(literalKeys("{\n  a: string\n  b: number\n}")).toEqual(["a", "b"])
    expect(literalKeys("{ \"quoted-key\": 1; 'other': 2 }")).toEqual(["quoted-key", "other"])
    expect(literalKeys("{ run(): void; value: string }")).toEqual(["run", "value"])
  })
  it("does not read into a nested type, a generic, a tuple or an arrow function", () => {
    expect(
      literalKeys(
        "{ a: { x: 1; y: 2 }; b: Map<string, number>; c: [number, string]; d: (n: number) => void }",
      ),
    ).toEqual(["a", "b", "c", "d"])
    expect(literalKeys("{ a: () => void; b: string }")).toEqual(["a", "b"])
  })
  it("reads a key after any whitespace, including a newline and two spaces after readonly", () => {
    expect(literalKeys("{\n\n   readonly  a: string;\n\t b: string }")).toEqual(["a", "b"])
  })
  it("ignores comments, whatever words they hold", () => {
    expect(
      literalKeys(
        "{\n  /** Used by every caller, or mirroring another; even this. */\n  a: string; // trailing: note\n  /* b: 1 */\n  c: number\n}",
      ),
    ).toEqual(["a", "c"])
  })
  it("reads a literal with whitespace around its braces", () => {
    expect(literalKeys("  { a: 1; b: 2 }\n")).toEqual(["a", "b"])
  })
  it("skips a member that is not a named one", () => {
    expect(literalKeys("{ [key: string]: number; a: string; (x: number): void }")).toEqual(["a"])
  })
  it("has no keys when there are none", () => {
    expect(literalKeys("{}")).toEqual([])
    expect(literalKeys("{ }")).toEqual([])
  })
})

describe("keysOf", () => {
  const declared = new Map<string, object>(
    [
      iface("Base", ["id"]),
      iface("Options", ["a", "b"], ["Base"]),
      alias("Literal", "{ x: number; y: number }"),
      alias("Alias", "Options"),
      alias("Union", "string | number"),
    ].map((member) => [member.name, member]),
  )
  it("finds an interface's own keys and the keys it extends", () => {
    expect(keysOf("Options", declared).sort()).toEqual(["a", "b", "id"])
    expect(keysOf("Base", declared)).toEqual(["id"])
  })
  it("sees through Readonly, Partial and Required, an alias, and an inline object", () => {
    expect(keysOf("Readonly<Options>", declared).sort()).toEqual(["a", "b", "id"])
    expect(keysOf("Partial<Base>", declared)).toEqual(["id"])
    expect(keysOf("Required<Literal>", declared)).toEqual(["x", "y"])
    expect(keysOf("Alias", declared).sort()).toEqual(["a", "b", "id"])
    expect(keysOf("Literal", declared)).toEqual(["x", "y"])
    expect(keysOf("{ p: 1; q: 2 }", declared)).toEqual(["p", "q"])
    expect(keysOf("  Base  ", declared)).toEqual(["id"])
  })
  it("follows a generic type by its own name, ignoring what it is applied to", () => {
    expect(keysOf("Options<TChecks>", declared).sort()).toEqual(["a", "b", "id"])
    expect(keysOf("Options<A, B<C>>", declared).sort()).toEqual(["a", "b", "id"])
    expect(keysOf("Readonly<Options<T>>", declared).sort()).toEqual(["a", "b", "id"])
    expect(keysOf("Promise<Options>", declared)).toEqual([])
  })
  it("has no keys for a scalar, a union, a generic, a function or a type from elsewhere", () => {
    for (const type of [
      "string",
      "Union",
      "Map<string, number>",
      "(a: number) => void",
      "Unknown",
      "A | B",
      "",
    ]) {
      expect(keysOf(type, declared), type).toEqual([])
    }
  })
  it("treats a declaration with no members or no extends as empty, and skips an unnamed member", () => {
    const bare = new Map<string, object>([
      ["Empty", { kind: "Interface", name: "Empty", excerptTokens: [] }],
      [
        "Mixed",
        {
          kind: "Interface",
          name: "Mixed",
          excerptTokens: [],
          members: [
            { kind: "IndexSignature" },
            property("k"),
            { kind: "MethodSignature", name: "m" },
          ],
        },
      ],
    ])
    expect(keysOf("Empty", bare)).toEqual([])
    expect(keysOf("Mixed", bare)).toEqual(["k", "m"])
  })
  it("follows a type once, even when two bases share it", () => {
    const diamond = new Map<string, object>(
      [
        iface("Top", ["t"]),
        iface("Left", ["l"], ["Top"]),
        iface("Right", ["r"], ["Top"]),
        iface("Both", ["b"], ["Left", "Right"]),
      ].map((member) => [member.name, member]),
    )
    expect(keysOf("Both", diamond).sort()).toEqual(["b", "l", "r", "t"])
  })
})

describe("signaturesOf", () => {
  const api = pkg(
    iface("Options", ["cache", "strict"]),
    fn("one", [["value", "string"]]),
    fn("two", [
      ["schema", "object"],
      ["options", "string"],
    ]),
    fn("keyed", [["options", "Options"]]),
    fn(
      "hidden",
      [
        ["a", "string"],
        ["b", "string"],
      ],
      "Internal",
    ),
    fn(
      "beta",
      [
        ["a", "string"],
        ["b", "string"],
      ],
      "Beta",
    ),
    { kind: "Class", name: "Thing", releaseTag: "Public" },
  )
  it("lists the public functions, with each parameter, or each key of an object that has several", () => {
    const signatures = signaturesOf([api])
    expect(signatures.get("one")).toEqual({ paths: ["value"], multiInput: false })
    expect(signatures.get("two")).toEqual({ paths: ["schema", "options"], multiInput: true })
    expect(signatures.get("keyed")).toEqual({
      paths: ["options.cache", "options.strict"],
      multiInput: true,
    })
    expect(signatures.get("beta")?.multiInput).toBe(true)
  })
  it("leaves out what is not public, and what is not a function", () => {
    const names = [...signaturesOf([api]).keys()]
    expect(names).not.toContain("hidden")
    expect(names).not.toContain("Thing")
    expect(names).not.toContain("Options")
  })
  it("joins the tokens of a type, and ignores the ones around it", () => {
    const api = pkg(
      iface("Options", ["x", "y"]),
      fn("wrapped", [
        ["first", "string"],
        ["o", ["Readonly<", "Options", ">"]],
      ]),
    )
    expect(signaturesOf([api]).get("wrapped")?.paths).toEqual(["first", "o.x", "o.y"])
  })
  it("takes an object with a single key as the parameter itself", () => {
    const single = pkg(iface("One", ["only"]), fn("f", [["options", "One"]]))
    expect(signaturesOf([single]).get("f")).toEqual({ paths: ["options"], multiInput: false })
  })
  it("merges overloads and entry points, and reads a package with no members", () => {
    const merged = signaturesOf([
      pkg(fn("f", [["a", "string"]])),
      pkg(
        fn("f", [
          ["a", "string"],
          ["b", "number"],
        ]),
      ),
    ])
    expect(merged.get("f")).toEqual({ paths: ["a", "b"], multiInput: true })
    expect(signaturesOf([{ members: [{ members: [] }] }]).size).toBe(0)
    expect(signaturesOf([]).size).toBe(0)
  })
  it("follows an alias, and ignores a declaration that is neither an interface nor an alias", () => {
    const api = pkg(
      alias("Opts", "{ a: number; b: number }"),
      { kind: "Class", name: "Thing", excerptTokens: [], members: [property("p"), property("q")] },
      fn("viaAlias", [["o", "Opts"]]),
      fn("viaClass", [["o", "Thing"]]),
    )
    const signatures = signaturesOf([api])
    expect(signatures.get("viaAlias")?.paths).toEqual(["o.a", "o.b"])
    expect(signatures.get("viaClass")?.paths).toEqual(["o"])
  })
  it("resolves a parameter's type across entry points", () => {
    const merged = signaturesOf([pkg(iface("Shared", ["x", "y"])), pkg(fn("f", [["o", "Shared"]]))])
    expect(merged.get("f")?.paths).toEqual(["o.x", "o.y"])
  })
})

describe("parametersOf", () => {
  it("lists parameters by name and type, however they are written", () => {
    expect(parametersOf("a: string, b?: number, ...rest: Validator<T>[]")).toEqual([
      { name: "a", type: "string" },
      { name: "b", type: "number" },
      { name: "rest", type: "Validator<T>[]" },
    ])
  })
  it("does not split inside a generic, a function type, an object or a tuple", () => {
    expect(
      parametersOf(
        "map: Map<string, number>, fn: (a: number, b: number) => void, o: { x: 1, y: 2 }, t: [number, string]",
      ).map((p) => p.name),
    ).toEqual(["map", "fn", "o", "t"])
    expect(parametersOf("f: (a) => void, g: string")).toHaveLength(2)
  })
  it("reads a parameter whatever the spacing around its colon", () => {
    expect(parametersOf("a:string, b  :  number,   c?  : boolean")).toEqual([
      { name: "a", type: "string" },
      { name: "b", type: "number" },
      { name: "c", type: "boolean" },
    ])
  })
  it("skips a destructured parameter, which has no name of its own", () => {
    expect(parametersOf("{ a: 1 }: Opts, b: string")).toEqual([{ name: "b", type: "string" }])
  })
  it("has no parameters for an empty list", () => {
    expect(parametersOf("")).toEqual([])
  })
})

describe("functions held by a public object", () => {
  const holder = (name: string, type: string, releaseTag = "Public") => ({
    kind: "Variable",
    name,
    releaseTag,
    excerptTokens: [
      { kind: "Content", text: `${name}: ` },
      { kind: "Content", text: type },
    ],
    variableTypeTokenRange: { startIndex: 1, endIndex: 2 },
  })
  const declarations = [
    [
      "declare function range(minimum: number, maximum: number): Validator<number>;",
      "declare function one(value: string): Validator<string>;",
      "declare function all<T>(...validators: Validator<T>[]): Validator<T>;",
      "export declare function opts<T extends object>(options: Options, extra?: string): void;",
      "declare function length_2(expected: number): Validator<string>;",
    ].join("\n"),
  ]
  const api = pkg(
    iface("Options", ["cache", "strict"]),
    holder(
      "validators",
      "{ range: typeof range; one: typeof one; all: typeof all; len: typeof length_2; missing: typeof nowhere }",
    ),
    holder("tools", "{ opts: typeof opts }"),
    holder("hidden", "{ range: typeof range }", "Internal"),
  )
  it("reads them from the rolled-up declarations, naming each after its object", () => {
    const signatures = signaturesOf([api], declarations)
    expect(signatures.get("validators.range")).toEqual({
      paths: ["minimum", "maximum"],
      multiInput: true,
    })
    expect(signatures.get("validators.one")).toEqual({ paths: ["value"], multiInput: false })
    expect(signatures.get("validators.all")).toEqual({ paths: ["validators"], multiInput: false })
    expect(signatures.get("validators.len")?.paths).toEqual(["expected"])
  })
  it("reads past a function's own generics, and expands an object parameter", () => {
    expect(signaturesOf([api], declarations).get("tools.opts")).toEqual({
      paths: ["options.cache", "options.strict", "extra"],
      multiInput: true,
    })
  })
  it("leaves out a member with no declaration, an object that is not public, and everything without declarations", () => {
    const signatures = signaturesOf([api], declarations)
    expect(signatures.has("validators.missing")).toBe(false)
    expect(signatures.has("hidden.range")).toBe(false)
    expect([...signaturesOf([api]).keys()]).toEqual([])
  })
})

describe("types declared only in the rolled-up declarations", () => {
  const dts = [
    "declare interface Base { root: string; fs: string }",
    "declare interface Options<T> extends Base, Other { include: T; exclude?: T }",
    "declare interface Other {",
    "  readonly extra: number;",
    "  nested: { a: 1; b: 2 };",
    "}",
    "export declare interface Shown { x: 1; y: 2 }",
    "declare type Alias = { p: 1; q: 2 };",
    "declare type Chain = Alias;",
    "declare type Generic<T> = Base;",
    "declare function viaInterface(options: Options<string>): void;",
    "declare function viaAlias(a: Alias, b: Chain): void;",
    "declare function viaGeneric(g: Generic<number>): void;",
    "declare function plain(only: string): void;",
  ].join("\n")
  const holder = {
    kind: "Variable",
    name: "tools",
    releaseTag: "Public",
    excerptTokens: [
      { kind: "Content", text: "tools: " },
      {
        kind: "Content",
        text: "{ viaInterface: typeof viaInterface; viaAlias: typeof viaAlias; viaGeneric: typeof viaGeneric; plain: typeof plain }",
      },
    ],
    variableTypeTokenRange: { startIndex: 1, endIndex: 2 },
  }
  const signaturesOfDts = () => signaturesOf([pkg(holder, fn("shown", [["o", "Shown"]]))], [dts])
  const more = [
    "declare interface Tight{ a: 1; b: 2 }",
    "// declare interface Fake { a: 1; b: 2 }",
    "// declare function hidden(a: string, b: string): void;",
    "export declare type Exported = { p: 1; q: 2 };",
    "declare type Tight2={ r: 1; s: 2 };",
    "declare interface Single { only: 1 }",
    "declare interface Edge{a: 1;b}",
    "declare interface Arrow<F = () => void> extends Edge { k1: F; k2: F }",
    "declare type Gen<T>= Edge;",
    "declare function lit(p: { m: 1; n: 2 }, a: Arrow<1>, g: Gen<2>): void;",
    "declare interface Wide<T>  extends  Single ,  Edge  { w: T; v: T }",
    "declare function edgy(e: Edge, w: Wide<1>): void;",
    "declare function spaced <T> (x: T, y: T): void;",
    "// declare interface Fake { f1: 1; f2: 2 }",
    "declare function fakeFn(f: Fake): void;",
    "declare function tightFn(a: Tight, b: Exported, c: Tight2, d: Single): void;",
  ].join("\n")
  const holderTwo = (releaseTag: string) => ({
    kind: "Variable",
    name: "kit",
    releaseTag,
    excerptTokens: [
      { kind: "Content", text: "kit: " },
      {
        kind: "Content",
        text: "{spaced:typeof  spaced; hidden: typeof hidden; tight: typeof tightFn; edgy: typeof edgy; lit: typeof lit; fake: typeof fakeFn}",
      },
    ],
    variableTypeTokenRange: { startIndex: 1, endIndex: 2 },
  })
  it("reads declarations written without the usual spacing, and ignores a mention in a comment", () => {
    const found = signaturesOf([pkg(holderTwo("Beta"))], [more])
    expect(found.get("kit.spaced")?.paths).toEqual(["x", "y"])
    expect(found.has("kit.hidden")).toBe(false)
    expect(found.get("kit.edgy")?.paths).toEqual([
      "e.a",
      "e.b",
      "w.only",
      "w.a",
      "w.b",
      "w.w",
      "w.v",
    ])
    expect(found.get("kit.lit")?.paths).toEqual([
      "p.m",
      "p.n",
      "a.a",
      "a.b",
      "a.k1",
      "a.k2",
      "g.a",
      "g.b",
    ])
    expect(found.get("kit.fake")?.paths).toEqual(["f"])
    expect(found.get("kit.tight")?.paths).toEqual(["a.a", "a.b", "b.p", "b.q", "c.r", "c.s", "d"])
  })
  it("leaves out a held function whose object is not public, even with declarations", () => {
    expect(signaturesOf([pkg(holderTwo("Internal"))], [more]).size).toBe(0)
  })
  it("reads an interface's keys, and the keys of every base it extends, however many", () => {
    expect(signaturesOfDts().get("tools.viaInterface")?.paths.sort()).toEqual(
      [
        "options.exclude",
        "options.extra",
        "options.fs",
        "options.include",
        "options.nested",
        "options.root",
      ].sort(),
    )
  })
  it("reads a type alias, one that names another, and a generic alias", () => {
    expect(signaturesOfDts().get("tools.viaAlias")?.paths).toEqual(["a.p", "a.q", "b.p", "b.q"])
    expect(signaturesOfDts().get("tools.viaGeneric")?.paths).toEqual(["g.root", "g.fs"])
  })
  it("leaves a plain parameter, and prefers the model's own declaration of an exported type", () => {
    expect(signaturesOfDts().get("tools.plain")?.paths).toEqual(["only"])
    expect(signaturesOfDts().get("shown")?.paths).toEqual(["o.x", "o.y"])
  })
})

describe("parseAccounting", () => {
  it("reads each of the five forms", () => {
    expect(parseAccounting("swept")).toEqual({ kind: "swept" })
    expect(parseAccounting("see sweep: width")).toBeUndefined()
    expect(parseAccounting("so variant: cold")).toBeUndefined()
    expect(parseAccounting("note fixed: a long enough reason")).toBeUndefined()
    expect(parseAccounting(" sweep: width ")).toEqual({ kind: "sweep", name: "width" })
    expect(parseAccounting("variant:cold")).toEqual({ kind: "variant", name: "cold" })
    expect(parseAccounting("fixed: held at ten on purpose")).toEqual({
      kind: "fixed",
      reason: "held at ten on purpose",
    })
    expect(parseAccounting("not covered:  only changes the message text ")).toEqual({
      kind: "not covered",
      reason: "only changes the message text",
    })
  })
  it("rejects anything else, and a reason that says nothing", () => {
    for (const value of [
      "",
      "sweep:",
      "sweep: a b",
      "fixed:",
      "fixed: short",
      "maybe",
      3,
      null,
      undefined,
      "swept now",
    ]) {
      expect(parseAccounting(value), String(value)).toBeUndefined()
    }
    expect(MIN_REASON).toBe(10)
    expect(parseAccounting(`fixed: ${"x".repeat(MIN_REASON)}`)?.kind).toBe("fixed")
    expect(parseAccounting(`fixed: ${"x".repeat(MIN_REASON - 1)}`)).toBeUndefined()
  })
})

describe("coverageFindings", () => {
  const signatures = new Map([
    ["multi", { paths: ["a", "b.x", "b.y"], multiInput: true }],
    ["single", { paths: ["a"], multiInput: false }],
    ["skipped", { paths: ["a", "b"], multiInput: true }],
  ])
  const bench = (covers: Record<string, Record<string, string>>) => ({
    suite: "s",
    benchmark: "f",
    covers,
  })
  it("asks for a benchmark of a function with several inputs, naming them", () => {
    expect(coverageFindings(signatures, [], { skipped: "x" })).toEqual([
      {
        kind: "unbenchmarked",
        function: "multi",
        message:
          "`multi` takes 3 inputs (a, b.x, b.y) and no benchmark exercises it. Benchmark it, or say why not under `notBenchmarked`.",
      },
    ])
  })
  it("asks for every input to be accounted for, in whichever benchmark covers it", () => {
    const findings = coverageFindings(
      signatures,
      [
        bench({ multi: { a: "swept" } }),
        { suite: "s", benchmark: "g", covers: { multi: { "b.x": "swept" } } },
      ],
      { skipped: "x" },
    )
    expect(findings).toEqual([
      {
        kind: "unaccounted",
        function: "multi",
        path: "b.y",
        message:
          "`multi`: `b.y` is not accounted for. In the benchmark that covers it, say whether it is swept, a variant, fixed (and why) or not covered (and why).",
      },
    ])
  })
  it("asks for a benchmark when only other functions are benchmarked", () => {
    const findings = coverageFindings(signatures, [bench({ other: { a: "swept" } })], {
      skipped: "x",
    })
    expect(findings.filter((f) => f.kind === "unbenchmarked").map((f) => f.function)).toEqual([
      "multi",
    ])
  })
  it("is satisfied when every input is accounted for, or the function is listed as not benchmarked", () => {
    expect(
      coverageFindings(
        signatures,
        [bench({ multi: { a: "swept", "b.x": "swept", "b.y": "swept" } })],
        {
          skipped: "x",
        },
      ),
    ).toEqual([])
    expect(coverageFindings(signatures, [], { multi: "x", skipped: "y" })).toEqual([])
  })
  it("does not ask about a function with a single input", () => {
    expect(coverageFindings(signatures, [], { multi: "x", skipped: "y" })).toEqual([])
  })
  it("calls a name that is not a public function, or a path it does not take, stale", () => {
    const findings = coverageFindings(
      signatures,
      [
        bench({
          ghost: { a: "swept" },
          multi: { a: "swept", "b.x": "swept", "b.y": "swept", "b.z": "swept" },
        }),
      ],
      { skipped: "x", phantom: "y" },
    )
    expect(findings).toEqual([
      {
        kind: "stale",
        function: "ghost",
        message: "s / f covers `ghost`, which is not a public function of this package.",
      },
      {
        kind: "stale",
        function: "multi",
        path: "b.z",
        message: "s / f accounts for `multi`: `b.z`, which that function does not take.",
      },
      {
        kind: "stale",
        function: "phantom",
        message:
          "`notBenchmarked` names `phantom`, which is not a public function of this package.",
      },
    ])
  })
})

describe("scanCoverage", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-coverage-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const put = (file: string, value: unknown) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), JSON.stringify(value))
  }
  const baseline = (entry: string, api: object) =>
    put(`${API_CONTRACT_DIR}/${entry}/baseline.api.json`, api)
  const api = pkg(
    fn("load", [
      ["a", "string"],
      ["b", "number"],
    ]),
    fn("solo", [["a", "string"]]),
  )

  it("has nothing to cover without an API baseline", () => {
    expect(scanCoverage(dir)).toEqual({
      state: "no-api",
      suites: [],
      functions: 0,
      findings: [],
      stale: [],
    })
    mkdirSync(path.join(dir, API_CONTRACT_DIR, "empty"), { recursive: true })
    expect(scanCoverage(dir).state).toBe("no-api")
  })
  it("reads every entry point's baseline and declarations, in order, ignoring a folder without one", () => {
    baseline("b", pkg(fn("x", [["p", "string"]])))
    baseline("a", pkg(fn("y", [["p", "string"]])))
    mkdirSync(path.join(dir, API_CONTRACT_DIR, "c"))
    writeFileSync(
      path.join(dir, API_CONTRACT_DIR, "a", "baseline.d.ts"),
      "declare function y(): void",
    )
    const { models, declarations } = readBaselines(dir)
    expect(
      models.map(
        (p) => (p as { members: { members: { name: string }[] }[] }).members[0]?.members[0]?.name,
      ),
    ).toEqual(["y", "x"])
    expect(declarations).toEqual(["declare function y(): void"])
  })
  it("reports every multi-input function when there are no suites", () => {
    baseline("main", api)
    const scan = scanCoverage(dir)
    expect(scan.state).toBe("checked")
    expect(scan.functions).toBe(1)
    expect(scan.findings.map((f: { kind: string }) => f.kind)).toEqual(["unbenchmarked"])
  })
  it("reads what each suite covers, and what it leaves out", () => {
    baseline("main", api)
    put("benchmarks/one/results.json", {
      analysis: {
        coverage: { benchmarks: [{ id: "load", covers: { load: { a: "swept", b: "swept" } } }] },
      },
    })
    put("benchmarks/two/results.json", {
      analysis: { coverage: { notBenchmarked: { other: "x" } } },
    })
    const scan = scanCoverage(dir)
    expect(scan.suites).toEqual(["one", "two"])
    expect(scan.findings).toEqual([expect.objectContaining({ kind: "stale", function: "other" })])
  })
  it("reads the functions a public object holds from the entry point's declarations", () => {
    baseline(
      "main",
      pkg({
        kind: "Variable",
        name: "validators",
        releaseTag: "Public",
        excerptTokens: [
          { kind: "Content", text: "validators: " },
          { kind: "Content", text: "{ range: typeof range }" },
        ],
        variableTypeTokenRange: { startIndex: 1, endIndex: 2 },
      }),
    )
    writeFileSync(
      path.join(dir, API_CONTRACT_DIR, "main", "baseline.d.ts"),
      "declare function range(minimum: number, maximum: number): void;\n",
    )
    put("benchmarks/s/results.json", {
      analysis: {
        coverage: {
          benchmarks: [
            { id: "range", covers: { "validators.range": { minimum: "swept", maximum: "swept" } } },
          ],
        },
      },
    })
    expect(scanCoverage(dir)).toMatchObject({ state: "checked", functions: 1, findings: [] })
    put("benchmarks/s/results.json", { analysis: { coverage: { benchmarks: [] } } })
    expect(scanCoverage(dir).findings.map((f: { function: string }) => f.function)).toEqual([
      "validators.range",
    ])
  })
  it("names the suites whose results do not say what they cover", () => {
    baseline("main", api)
    put("benchmarks/old/results.json", { analysis: {} })
    put("benchmarks/new/results.json", { analysis: { coverage: { benchmarks: [] } } })
    const scan = scanCoverage(dir)
    expect(scan).toMatchObject({ state: "no-coverage", stale: ["old"], findings: [] })
  })
  it("tolerates results with no analysis at all", () => {
    baseline("main", api)
    put("benchmarks/bare/results.json", {})
    put("benchmarks/null/results.json", null)
    expect(scanCoverage(dir)).toMatchObject({ state: "no-coverage", stale: ["bare", "null"] })
  })
})

describe("benchmarkCoverageCheck (policy)", () => {
  const judge = (value: unknown) =>
    benchmarkCoverageCheck().policy(makeContext(makeJsonResult(value)))
  it("runs the bundled script and asks for JSON", () => {
    const check = benchmarkCoverageCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-benchmark-coverage\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes a package with no API baseline", async () => {
    expect(await judge({ ok: true, state: "no-api" })).toEqual({
      outcome: "pass",
      rationale:
        "BenchmarkCoverage: this package commits no API baseline, so it has no public functions to cover.",
    })
  })
  it("fails, naming the suites to re-render", async () => {
    expect(await judge({ ok: true, state: "no-coverage", stale: ["a", "b"] })).toEqual({
      outcome: "fail",
      rationale:
        "BenchmarkCoverage: 2 benchmark suite(s) have committed results that do not say what they cover. Re-render them with `benchmark --render` (no measuring) and commit the result:\n- benchmarks/a/results.json\n- benchmarks/b/results.json",
    })
  })
  it("fails with every gap", async () => {
    expect(
      await judge({
        ok: true,
        state: "checked",
        findings: [{ message: "one" }, { message: "two" }],
      }),
    ).toEqual({
      outcome: "fail",
      rationale:
        "BenchmarkCoverage: 2 gap(s) between the public functions that take several inputs and the benchmarks that cover them:\n- one\n- two",
    })
  })
  it("passes when everything is covered", async () => {
    expect(
      await judge({ ok: true, state: "checked", functions: 3, suites: ["a", "b"], findings: [] }),
    ).toEqual({
      outcome: "pass",
      rationale:
        "BenchmarkCoverage: all 3 public function(s) with several inputs are benchmarked, and every one of their inputs is accounted for (2 suite(s)).",
    })
  })
  it("fails closed on output that is not the envelope or a run that did not finish", async () => {
    const bad = await benchmarkCoverageCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("BenchmarkCoverage: output could not be parsed as JSON.\noops")
    const stuck = await benchmarkCoverageCheck().policy(
      makeContext(makeResult({ status: "timed_out" })),
    )
    expect(stuck.rationale).toBe(
      "check-benchmark-coverage did not run to completion (status: timed_out).",
    )
  })
})
