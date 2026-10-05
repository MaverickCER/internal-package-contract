import { describe, expect, it } from "vitest"
import type { NormalizedMember } from "../scripts/api-contract/model-normalizer.js"
import { detectSchemaVersionDrift } from "../scripts/api-contract/schema-version-consistency.js"

const interfaceOf = (name: string, extra: Partial<NormalizedMember> = {}): NormalizedMember => ({
  canonicalReference: `fx!${name}:interface`,
  name,
  scopedName: name,
  kind: "Interface",
  isTopLevelExport: true,
  releaseTag: "public",
  isDeprecated: false,
  ...extra,
})

const child = (
  parent: string,
  name: string,
  type: string,
  extra: Partial<NormalizedMember> = {},
): NormalizedMember => ({
  canonicalReference: `fx!${parent}#${name}:member`,
  name,
  scopedName: `${parent}.${name}`,
  kind: "PropertySignature",
  parentCanonicalReference: `fx!${parent}:interface`,
  isTopLevelExport: false,
  releaseTag: "public",
  isDeprecated: false,
  propertyTypeExcerptText: type,
  ...extra,
})

const toMap = (members: readonly NormalizedMember[]) =>
  new Map(members.map((m) => [m.canonicalReference, m]))
const drift = (baseline: readonly NormalizedMember[], current: readonly NormalizedMember[]) =>
  detectSchemaVersionDrift(toMap(baseline), toMap(current))

const versioned = (name = "Doc", version = "1", extra: NormalizedMember[] = [], file?: string) => [
  interfaceOf(name, file ? { fileUrlPath: file } : {}),
  child(name, "version", version),
  ...extra,
]

describe("detectSchemaVersionDrift()", () => {
  it("reports a changed shape under an unchanged version literal, counting each kind of change", () => {
    const baseline = versioned("Doc", "1", [
      child("Doc", "gone1", "string"),
      child("Doc", "gone2", "string"),
      child("Doc", "kept1", "string"),
      child("Doc", "kept2", "string"),
      child("Doc", "kept3", "string"),
      child("Doc", "same", "string"),
    ])
    const current = versioned("Doc", "1", [
      child("Doc", "new1", "string"),
      child("Doc", "kept1", "number"),
      child("Doc", "kept2", "number"),
      child("Doc", "kept3", "number"),
      child("Doc", "same", "string"),
    ])
    expect(drift(baseline, current)).toEqual([
      {
        id: "fx!Doc:interface#schema-version-literal",
        path: "Doc",
        kind: "schema-version-literal-stale",
        compatibility: "breaking",
        explanation:
          "Doc changed shape (6 member(s) added/removed/changed) but its `version` literal is still 1 -- bump it to reflect the new schema shape.",
      },
    ])
  })

  it("counts a lone addition, removal or change as one", () => {
    const base = [child("Doc", "a", "string")]
    const count = (current: NormalizedMember[]) =>
      drift(versioned("Doc", "1", base), versioned("Doc", "1", current))[0]?.explanation.match(
        /\((\d+) member/,
      )?.[1]
    expect(count([...base, child("Doc", "b", "string")])).toBe("1")
    expect(count([])).toBe("1")
    expect(count([child("Doc", "a", "number")])).toBe("1")
  })

  it("names the file the interface lives in", () => {
    const result = drift(
      versioned("Doc", "1", [], "src/doc.ts"),
      versioned("Doc", "1", [child("Doc", "x", "string")], "src/doc.ts"),
    )
    expect(result[0]?.explanation).toBe(
      "Doc in src/doc.ts changed shape (1 member(s) added/removed/changed) but its `version` literal is still 1 -- bump it to reflect the new schema shape.",
    )
  })

  it("is silent when the literal moved, nothing else changed, or only a file moved", () => {
    expect(
      drift(versioned("Doc", "1"), versioned("Doc", "2", [child("Doc", "x", "string")])),
    ).toEqual([])
    expect(
      drift(
        versioned("Doc", "1", [child("Doc", "x", "string")]),
        versioned("Doc", "1", [child("Doc", "x", "string")]),
      ),
    ).toEqual([])
    expect(
      drift(
        versioned("Doc", "1", [child("Doc", "x", "string", { fileUrlPath: "a.ts" })]),
        versioned("Doc", "1", [child("Doc", "x", "string", { fileUrlPath: "b.ts" })]),
      ),
    ).toEqual([])
  })

  it("recognises string and negative numeric literals as version literals, and nothing wider", () => {
    for (const literal of ['"v1"', "'v1'", "-1", "12"]) {
      const result = drift(
        versioned("Doc", literal),
        versioned("Doc", literal, [child("Doc", "x", "string")]),
      )
      expect(result, literal).toHaveLength(1)
      expect(result[0]?.explanation, literal).toContain(`is still ${literal} --`)
    }
    for (const type of ["number", "string", "1.5", "1 | 2", '"a" | "b"', ""]) {
      expect(
        drift(versioned("Doc", type), versioned("Doc", type, [child("Doc", "x", "string")])),
        type,
      ).toEqual([])
    }
  })

  it("only treats a member named exactly version as the version literal", () => {
    const named = (name: string) => [interfaceOf("Doc"), child("Doc", name, "1")]
    expect(drift(named("versions"), [...named("versions"), child("Doc", "x", "string")])).toEqual(
      [],
    )
    expect(drift(named("ver"), [...named("ver"), child("Doc", "x", "string")])).toEqual([])
  })

  it("skips a member with no property type, however it is named", () => {
    const noType = (extra: NormalizedMember[]) => [
      interfaceOf("Doc"),
      child("Doc", "version", "1", { propertyTypeExcerptText: undefined }),
      ...extra,
    ]
    expect(drift(noType([]), noType([child("Doc", "x", "string")]))).toEqual([])
  })

  it("needs the interface in both snapshots, as an interface, with the version literal on both sides", () => {
    const asClass = (members: NormalizedMember[]) =>
      members.map((m) => (m.kind === "Interface" ? { ...m, kind: "Class" } : m))
    const grown = versioned("Doc", "1", [child("Doc", "x", "string")])
    expect(drift(asClass(versioned("Doc", "1")), asClass(grown))).toEqual([])
    expect(drift(versioned("Doc", "1"), asClass(grown))).toEqual([])
    expect(drift(asClass(versioned("Doc", "1")), grown)).toEqual([])
    expect(drift([], grown)).toEqual([])
    expect(drift(versioned("Doc", "1"), grown)).toHaveLength(1)

    const noVersion = [interfaceOf("Doc"), child("Doc", "y", "string")]
    expect(drift(noVersion, grown)).toEqual([])
    expect(drift(versioned("Doc", "1"), [...noVersion, child("Doc", "x", "string")])).toEqual([])
    expect(drift(noVersion, [...noVersion, child("Doc", "x", "string")])).toEqual([])
  })

  it("sorts by id", () => {
    const grown = (name: string) => versioned(name, "1", [child(name, "x", "string")])
    const result = drift(
      [...versioned("Zed"), ...versioned("Alpha")],
      [...grown("Zed"), ...grown("Alpha")],
    )
    expect(result.map((change) => change.path)).toEqual(["Alpha", "Zed"])
  })
})
