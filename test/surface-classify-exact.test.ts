import { describe, expect, it } from "vitest"
import {
  classifySurface,
  flattenSchema,
  type Surface,
} from "../scripts/surface-contract/classify.js"

const empty: Surface = { cli: {}, schemas: {}, action: null }
const withSchema = (schema: unknown): Surface => ({ ...empty, schemas: { "./s": schema } })
const withCli = (help: string, exitCode: number | null = 0): Surface => ({
  ...empty,
  cli: { x: { exitCode, help } },
})
const act = (
  inputs: Record<string, { required: boolean; default: string | null }>,
  outputs: string[] = [],
): Surface => ({ ...empty, action: { inputs, outputs } })

describe("flattenSchema (exact)", () => {
  it("keeps scalar members of any type as set members and addresses objects in arrays by index", () => {
    expect(flattenSchema({ enum: [1, "1", true, null] }).structure).toEqual({
      "/enum#1": "",
      "/enum#true": "",
      "/enum#null": "",
    })
    expect(flattenSchema({ anyOf: [1, { type: "x" }] }).structure).toEqual({
      "/anyOf/0": "1",
      "/anyOf/1/type": '"x"',
    })
  })
  it("reads a null or a scalar leaf without descending into it", () => {
    expect(flattenSchema({ const: null, minimum: 0 }).structure).toEqual({
      "/const": "null",
      "/minimum": "0",
    })
    expect(flattenSchema("text").structure).toEqual({ "": '"text"' })
  })
  it("is independent of key order, including for documentation keywords", () => {
    const one = flattenSchema({ title: "t", description: "d", type: "x", a: 1 })
    const two = flattenSchema({ a: 1, type: "x", description: "d", title: "t" })
    expect(one).toEqual(two)
    expect(Object.keys(one.docs)).toEqual(["/description", "/title"])
    expect(Object.keys(one.structure)).toEqual(["/a", "/type"])
  })
  it("treats a definition named like a documentation keyword as a schema, and keeps nested docs apart", () => {
    const { structure, docs } = flattenSchema({
      $defs: { description: { type: "string", title: "T" } },
    })
    expect(structure).toEqual({ "/$defs/description/type": '"string"' })
    expect(docs).toEqual({ "/$defs/description/title": '"T"' })
  })
})

describe("classifySurface (every message, flag and impact)", () => {
  it("CLI changes", () => {
    expect(classifySurface(withCli("--a"), empty)).toEqual([
      {
        id: "cli:x",
        kind: "cli-removed",
        impact: "breaking",
        widens: false,
        explanation: "The `x` command was removed.",
      },
    ])
    expect(classifySurface(empty, withCli("--a"))).toEqual([
      {
        id: "cli:x",
        kind: "cli-added",
        impact: "compatible",
        widens: true,
        explanation: "The `x` command was added.",
      },
    ])
    expect(classifySurface(withCli("--a", 0), withCli("--a", null))).toEqual([
      {
        id: "cli:x",
        kind: "cli-exit-code-changed",
        impact: "breaking",
        widens: false,
        explanation: "`x --help` exited 0, now null.",
      },
    ])
    expect(classifySurface(withCli("--a --b"), withCli("--a --c"))).toEqual([
      {
        id: "cli:x:--b",
        kind: "cli-flag-removed",
        impact: "breaking",
        widens: false,
        explanation: "`x` no longer documents --b.",
      },
      {
        id: "cli:x:--c",
        kind: "cli-flag-added",
        impact: "compatible",
        widens: true,
        explanation: "`x` now documents --c.",
      },
    ])
    expect(classifySurface(withCli("old"), withCli("new"))).toEqual([
      {
        id: "cli:x",
        kind: "cli-help-changed",
        impact: "compatible",
        widens: false,
        explanation: "The `x --help` text changed.",
      },
    ])
  })

  it("whole schemas and the whole action", () => {
    expect(classifySurface(withSchema({}), empty)).toEqual([
      {
        id: "schema:./s",
        kind: "schema-removed",
        impact: "breaking",
        widens: false,
        explanation: "The schema served at ./s was removed.",
      },
    ])
    expect(classifySurface(empty, withSchema({}))).toEqual([
      {
        id: "schema:./s",
        kind: "schema-added",
        impact: "compatible",
        widens: true,
        explanation: "The schema served at ./s was added.",
      },
    ])
    expect(classifySurface(act({}), empty)).toEqual([
      {
        id: "action",
        kind: "action-removed",
        impact: "breaking",
        widens: false,
        explanation: "The GitHub Action was removed.",
      },
    ])
    expect(classifySurface(empty, act({}))).toEqual([
      {
        id: "action",
        kind: "action-added",
        impact: "compatible",
        widens: true,
        explanation: "The GitHub Action was added.",
      },
    ])
  })

  it("schema changes", () => {
    const base = { type: "object", required: ["a"], properties: { a: { type: "string" } } }
    const grown = { ...base, properties: { ...base.properties, b: { type: "number", minimum: 1 } } }
    expect(classifySurface(withSchema(base), withSchema(grown))).toEqual([
      {
        id: "schema:./s:/properties/b",
        kind: "schema-property-added",
        impact: "compatible",
        widens: true,
        explanation: "/properties/b is a new property in ./s.",
      },
    ])
    expect(classifySurface(withSchema(grown), withSchema(base))).toEqual([
      {
        id: "schema:./s:/properties/b",
        kind: "schema-property-removed",
        impact: "breaking",
        widens: false,
        explanation: "/properties/b was removed from ./s.",
      },
    ])
    expect(
      classifySurface(withSchema(base), withSchema({ ...base, required: ["a", "z"] })),
    ).toEqual([
      {
        id: "schema:./s:/required#z",
        kind: "schema-required-added",
        impact: "breaking",
        widens: false,
        explanation: "/required#z now lists z in ./s.",
      },
    ])
    expect(
      classifySurface(withSchema({ ...base, required: ["a", "z"] }), withSchema(base)),
    ).toEqual([
      {
        id: "schema:./s:/required#z",
        kind: "schema-required-removed",
        impact: "compatible",
        widens: false,
        explanation: "/required#z no longer lists z in ./s.",
      },
    ])
    expect(classifySurface(withSchema({ enum: ["x"] }), withSchema({ enum: ["x", "y"] }))).toEqual([
      {
        id: "schema:./s:/enum#y",
        kind: "schema-set-member-added",
        impact: "breaking",
        widens: false,
        explanation: "/enum#y now lists y in ./s.",
      },
    ])
    expect(classifySurface(withSchema({ enum: ["x", "y"] }), withSchema({ enum: ["x"] }))).toEqual([
      {
        id: "schema:./s:/enum#y",
        kind: "schema-set-member-removed",
        impact: "breaking",
        widens: false,
        explanation: "/enum#y no longer lists y in ./s.",
      },
    ])
    expect(classifySurface(withSchema({ type: "a" }), withSchema({ type: "b" }))).toEqual([
      {
        id: "schema:./s:/type",
        kind: "schema-changed",
        impact: "breaking",
        widens: false,
        explanation: '/type changed from "a" to "b" in ./s.',
      },
    ])
    expect(classifySurface(withSchema({}), withSchema({ maxItems: 2 }))).toEqual([
      {
        id: "schema:./s:/maxItems",
        kind: "schema-constraint-added",
        impact: "breaking",
        widens: false,
        explanation: "/maxItems is a new constraint in ./s.",
      },
    ])
    expect(classifySurface(withSchema({ maxItems: 2 }), withSchema({}))).toEqual([
      {
        id: "schema:./s:/maxItems",
        kind: "schema-constraint-removed",
        impact: "breaking",
        widens: false,
        explanation: "/maxItems was removed from ./s.",
      },
    ])
    expect(
      classifySurface(withSchema({ description: "a" }), withSchema({ description: "b" })),
    ).toEqual([
      {
        id: "schema:./s",
        kind: "schema-docs-changed",
        impact: "compatible",
        widens: false,
        explanation: "Descriptions or examples in ./s changed.",
      },
    ])
  })

  it("reads the keyword a set member belongs to at any depth", () => {
    const deep = (required: string[]) => withSchema({ properties: { o: { required } } })
    expect(classifySurface(deep(["a"]), deep(["a", "b"]))).toEqual([
      expect.objectContaining({
        id: "schema:./s:/properties/o/required#b",
        kind: "schema-required-added",
      }),
    ])
    expect(classifySurface(deep(["a", "b"]), deep(["a"]))).toEqual([
      expect.objectContaining({ kind: "schema-required-removed", impact: "compatible" }),
    ])
  })

  it("names a new property by its own root, never a sibling that shares a prefix", () => {
    const before = withSchema({ properties: { ab: { type: "string" } } })
    const after = withSchema({ properties: { a: { type: "string" }, ab: { type: "string" } } })
    expect(classifySurface(before, after)).toEqual([
      expect.objectContaining({
        id: "schema:./s:/properties/a",
        kind: "schema-property-added",
        widens: true,
      }),
    ])
    expect(classifySurface(after, before)).toEqual([
      expect.objectContaining({ id: "schema:./s:/properties/a", kind: "schema-property-removed" }),
    ])
  })

  it("reports a new nested property under an existing one as that nested property, once", () => {
    const before = withSchema({ properties: { o: { type: "object" } } })
    const after = withSchema({
      properties: { o: { type: "object", properties: { n: { type: "string", pattern: "x" } } } },
    })
    const changes = classifySurface(before, after)
    expect(changes).toEqual([
      expect.objectContaining({
        id: "schema:./s:/properties/o/properties/n",
        kind: "schema-property-added",
      }),
    ])
  })

  it("treats a constraint added inside an existing property as a constraint, not a new property", () => {
    const before = withSchema({ properties: { a: { type: "string" } } })
    const after = withSchema({ properties: { a: { type: "string", minLength: 2 } } })
    expect(classifySurface(before, after)).toEqual([
      expect.objectContaining({
        id: "schema:./s:/properties/a/minLength",
        kind: "schema-constraint-added",
      }),
    ])
    expect(classifySurface(after, before)).toEqual([
      expect.objectContaining({
        id: "schema:./s:/properties/a/minLength",
        kind: "schema-constraint-removed",
      }),
    ])
  })

  it("does not call a property new when it only gained or lost a scalar value at the same pointer", () => {
    const a = withSchema({ properties: { p: { type: "string" } } })
    const b = withSchema({ properties: { p: { type: "number" } } })
    expect(classifySurface(a, b)).toEqual([expect.objectContaining({ kind: "schema-changed" })])
  })

  it("reports each distinct leaf of a changed array of objects", () => {
    const a = withSchema({ anyOf: [{ type: "string" }, { type: "null" }] })
    const b = withSchema({ anyOf: [{ type: "string" }, { type: "number" }] })
    expect(classifySurface(a, b)).toEqual([
      expect.objectContaining({ id: "schema:./s:/anyOf/1/type", kind: "schema-changed" }),
    ])
  })

  it("action changes", () => {
    const opt = (def: string | null = null) => ({ required: false, default: def })
    const req = (def: string | null = null) => ({ required: true, default: def })
    expect(classifySurface(act({ a: opt() }), act({}))).toEqual([
      {
        id: "action:input:a",
        kind: "action-input-removed",
        impact: "breaking",
        widens: false,
        explanation: "Action input a was removed.",
      },
    ])
    expect(classifySurface(act({}), act({ a: opt() }))).toEqual([
      {
        id: "action:input:a",
        kind: "action-input-added",
        impact: "compatible",
        widens: true,
        explanation: "Action input a was added.",
      },
    ])
    expect(classifySurface(act({}), act({ a: req() }))).toEqual([
      {
        id: "action:input:a",
        kind: "action-input-added",
        impact: "breaking",
        widens: false,
        explanation: "Action input a was added and is required.",
      },
    ])
    expect(classifySurface(act({ a: opt() }), act({ a: req() }))).toEqual([
      {
        id: "action:input:a",
        kind: "action-input-required",
        impact: "breaking",
        widens: false,
        explanation: "Action input a is now required.",
      },
    ])
    expect(classifySurface(act({ a: req() }), act({ a: opt() }))).toEqual([
      {
        id: "action:input:a",
        kind: "action-input-optional",
        impact: "compatible",
        widens: false,
        explanation: "Action input a is now optional.",
      },
    ])
    expect(classifySurface(act({ a: opt("1") }), act({ a: opt("2") }))).toEqual([
      {
        id: "action:input:a",
        kind: "action-input-default-changed",
        impact: "breaking",
        widens: false,
        explanation: "Action input a has a different default.",
      },
    ])
    expect(classifySurface(act({}, ["o"]), act({}, []))).toEqual([
      {
        id: "action:output:o",
        kind: "action-output-removed",
        impact: "breaking",
        widens: false,
        explanation: "Action output o was removed.",
      },
    ])
    expect(classifySurface(act({}, []), act({}, ["o"]))).toEqual([
      {
        id: "action:output:o",
        kind: "action-output-added",
        impact: "compatible",
        widens: true,
        explanation: "Action output o was added.",
      },
    ])
  })

  it("sorts every kind of change together by id", () => {
    const before: Surface = {
      cli: { b: { exitCode: 0, help: "--x" } },
      schemas: { "./z": { a: 1 } },
      action: act({}).action,
    }
    const after: Surface = {
      cli: { b: { exitCode: 0, help: "--y" } },
      schemas: { "./z": { a: 2 } },
      action: act({ i: { required: false, default: null } }).action,
    }
    expect(classifySurface(before, after).map((c) => c.id)).toEqual([
      "action:input:i",
      "cli:b:--x",
      "cli:b:--y",
      "schema:./z:/a",
    ])
  })

  it("reports a changed exit code and changed help text together when no flag changed", () => {
    expect(classifySurface(withCli("old", 0), withCli("new", 1)).map((c) => c.kind)).toEqual([
      "cli-exit-code-changed",
      "cli-help-changed",
    ])
  })
  it("names a multi-character new property in full, and a nested one under a property with siblings", () => {
    const a = withSchema({ properties: { o: { type: "object" }, p: { type: "string" } } })
    const b = withSchema({
      properties: {
        o: { type: "object", properties: { n: { type: "string", pattern: "x" } } },
        p: { type: "string" },
        bcd: { type: "number" },
      },
    })
    expect(classifySurface(a, b).map((c) => c.id)).toEqual([
      "schema:./s:/properties/bcd",
      "schema:./s:/properties/o/properties/n",
    ])
  })
  it("keeps outputs that exist on both sides out of the changes", () => {
    const changes = classifySurface(act({}, ["keep", "gone"]), act({}, ["keep", "new"]))
    expect(changes.map((c) => c.id)).toEqual(["action:output:gone", "action:output:new"])
  })
})
