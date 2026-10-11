import { describe, expect, it } from "vitest"
import {
  classifySurface,
  flattenSchema,
  type Surface,
} from "../scripts/surface-contract/classify.js"

const empty: Surface = { cli: {}, schemas: {}, action: null }
const cli = (help: string, exitCode: number | null = 0) => ({ exitCode, help })
const kinds = (a: Surface, b: Surface) => classifySurface(a, b).map((c) => `${c.kind}:${c.impact}`)

describe("flattenSchema", () => {
  it("turns nested objects into pointer entries and arrays of scalars into sets", () => {
    const { structure, docs } = flattenSchema({
      type: "object",
      description: "top",
      required: ["b", "a"],
      properties: { a: { type: "string", title: "A" }, title: { type: "number" } },
    })
    expect(structure).toEqual({
      "/type": '"object"',
      "/required#a": "",
      "/required#b": "",
      "/properties/a/type": '"string"',
      "/properties/title/type": '"number"',
    })
    expect(docs).toEqual({ "/description": '"top"', "/properties/a/title": '"A"' })
  })
  it("keeps arrays of objects index-addressed and records an empty array", () => {
    const { structure } = flattenSchema({ anyOf: [{ type: "string" }, { type: "null" }], enum: [] })
    expect(structure).toEqual({
      "/anyOf/0/type": '"string"',
      "/anyOf/1/type": '"null"',
      "/enum": "[]",
    })
  })
})

describe("classifySurface: nothing changed", () => {
  it("reports no changes for identical surfaces", () => {
    const s: Surface = {
      cli: { x: cli("--a") },
      schemas: { "./s": { type: "object" } },
      action: null,
    }
    expect(classifySurface(s, structuredClone(s))).toEqual([])
  })
})

describe("classifySurface: CLIs", () => {
  it("treats a removed CLI as breaking and an added CLI as widening", () => {
    const withCli: Surface = { ...empty, cli: { x: cli("Usage: x --a") } }
    expect(kinds(withCli, empty)).toEqual(["cli-removed:breaking"])
    const added = classifySurface(empty, withCli)
    expect(added).toEqual([
      expect.objectContaining({
        id: "cli:x",
        kind: "cli-added",
        impact: "compatible",
        widens: true,
      }),
    ])
  })
  it("treats a removed flag as breaking and an added flag as widening", () => {
    const a: Surface = { ...empty, cli: { x: cli("Usage: x --alpha --beta-two") } }
    const b: Surface = { ...empty, cli: { x: cli("Usage: x --alpha --gamma") } }
    expect(classifySurface(a, b).map((c) => [c.id, c.kind, c.impact, c.widens])).toEqual([
      ["cli:x:--beta-two", "cli-flag-removed", "breaking", false],
      ["cli:x:--gamma", "cli-flag-added", "compatible", true],
    ])
  })
  it("treats an exit-code change as breaking", () => {
    expect(
      kinds({ ...empty, cli: { x: cli("h", 0) } }, { ...empty, cli: { x: cli("h", 2) } }),
    ).toEqual(["cli-exit-code-changed:breaking"])
  })
  it("treats help text that changed without any flag change as a compatible, non-widening change", () => {
    const r = classifySurface(
      { ...empty, cli: { x: cli("--a  old") } },
      { ...empty, cli: { x: cli("--a  new") } },
    )
    expect(r).toEqual([
      expect.objectContaining({
        id: "cli:x",
        kind: "cli-help-changed",
        impact: "compatible",
        widens: false,
      }),
    ])
  })
  it("does not also report help text when a flag change already explains it", () => {
    expect(
      kinds({ ...empty, cli: { x: cli("--a") } }, { ...empty, cli: { x: cli("--a --b") } }),
    ).toEqual(["cli-flag-added:compatible"])
  })
  it("does not mistake a hyphenated word or a single dash for a flag", () => {
    const r = classifySurface(
      { ...empty, cli: { x: cli("a - b") } },
      { ...empty, cli: { x: cli("a - c") } },
    )
    expect(r.map((c) => c.kind)).toEqual(["cli-help-changed"])
    expect(
      classifySurface(
        { ...empty, cli: { x: cli("e.g. --Foo") } },
        { ...empty, cli: { x: cli("e.g. --Foo --x1-y") } },
      ).map((c) => c.id),
    ).toEqual(["cli:x:--x1-y"])
  })
})

describe("classifySurface: schemas", () => {
  const s = (schema: unknown): Surface => ({ ...empty, schemas: { "./schema": schema } })
  const base = { type: "object", required: ["a"], properties: { a: { type: "string" } } }

  it("treats a removed or added schema file as breaking or widening", () => {
    expect(kinds(s(base), empty)).toEqual(["schema-removed:breaking"])
    expect(classifySurface(empty, s(base))).toEqual([
      expect.objectContaining({ id: "schema:./schema", kind: "schema-added", widens: true }),
    ])
  })
  it("treats a new optional property as compatible and widening", () => {
    const next = { ...base, properties: { ...base.properties, b: { type: "number" } } }
    expect(classifySurface(s(base), s(next))).toEqual([
      expect.objectContaining({
        id: "schema:./schema:/properties/b",
        kind: "schema-property-added",
        impact: "compatible",
        widens: true,
      }),
    ])
  })
  it("treats a newly required property as breaking, and a relaxed one as compatible", () => {
    const stricter = {
      ...base,
      required: ["a", "b"],
      properties: { ...base.properties, b: { type: "number" } },
    }
    expect(kinds(s(base), s(stricter))).toEqual([
      "schema-property-added:compatible",
      "schema-required-added:breaking",
    ])
    expect(kinds(s(stricter), s(base))).toEqual([
      "schema-property-removed:breaking",
      "schema-required-removed:compatible",
    ])
  })
  it("treats a changed type, a removed constraint and a new constraint as breaking", () => {
    expect(kinds(s(base), s({ ...base, properties: { a: { type: "number" } } }))).toEqual([
      "schema-changed:breaking",
    ])
    expect(
      kinds(
        s(base),
        s({
          type: "object",
          properties: { a: { type: "string" } },
          required: ["a"],
          additionalProperties: false,
        }),
      ),
    ).toEqual(["schema-constraint-added:breaking"])
    expect(kinds(s({ ...base, minProperties: 1 }), s(base))).toEqual([
      "schema-constraint-removed:breaking",
    ])
  })
  it("treats any change to a set-valued keyword, such as enum, as breaking in both directions", () => {
    const a = s({ enum: ["x", "y"] })
    const b = s({ enum: ["x", "y", "z"] })
    expect(kinds(a, b)).toEqual(["schema-set-member-added:breaking"])
    expect(kinds(b, a)).toEqual(["schema-set-member-removed:breaking"])
  })
  it("treats description, title and examples changes as one compatible documentation change", () => {
    const r = classifySurface(
      s({ ...base, description: "old", title: "T" }),
      s({ ...base, description: "new", examples: [{ a: "x" }] }),
    )
    expect(r).toEqual([
      expect.objectContaining({
        id: "schema:./schema",
        kind: "schema-docs-changed",
        impact: "compatible",
        widens: false,
      }),
    ])
  })
  it("does not treat a property literally named like a documentation keyword as documentation", () => {
    const a = s({ properties: { title: { type: "string" } } })
    const b = s({ properties: { title: { type: "number" } } })
    expect(kinds(a, b)).toEqual(["schema-changed:breaking"])
  })
})

describe("classifySurface: action", () => {
  const act = (
    inputs: Record<string, { required: boolean; default: string | null }>,
    outputs: string[] = [],
  ): Surface => ({
    ...empty,
    action: { inputs, outputs },
  })
  it("treats a removed action as breaking and a new one as widening", () => {
    expect(kinds(act({}), empty)).toEqual(["action-removed:breaking"])
    expect(classifySurface(empty, act({}))[0]).toMatchObject({ kind: "action-added", widens: true })
  })
  it("treats removed inputs and outputs as breaking and added optional ones as widening", () => {
    const before = act({ a: { required: false, default: "1" } }, ["o"])
    const after = act({ b: { required: false, default: null } }, ["p"])
    expect(classifySurface(before, after).map((c) => [c.id, c.kind, c.impact, c.widens])).toEqual([
      ["action:input:a", "action-input-removed", "breaking", false],
      ["action:input:b", "action-input-added", "compatible", true],
      ["action:output:o", "action-output-removed", "breaking", false],
      ["action:output:p", "action-output-added", "compatible", true],
    ])
  })
  it("treats a new required input, a newly required input and a changed default as breaking", () => {
    const none = act({})
    expect(kinds(none, act({ a: { required: true, default: null } }))).toEqual([
      "action-input-added:breaking",
    ])
    const opt = act({ a: { required: false, default: "1" } })
    expect(kinds(opt, act({ a: { required: true, default: "1" } }))).toEqual([
      "action-input-required:breaking",
    ])
    expect(kinds(act({ a: { required: true, default: "1" } }), opt)).toEqual([
      "action-input-optional:compatible",
    ])
    expect(kinds(opt, act({ a: { required: false, default: "2" } }))).toEqual([
      "action-input-default-changed:breaking",
    ])
  })
})
