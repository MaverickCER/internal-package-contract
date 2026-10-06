import { describe, expect, it } from "vitest"
import type { AssignabilityQuery } from "../scripts/api-contract/compatibility-classifier.js"
import { classifyContractChanges } from "../scripts/api-contract/compatibility-classifier.js"
import type { NormalizedMember } from "../scripts/api-contract/model-normalizer.js"

type Overrides = Partial<NormalizedMember> & { readonly canonicalReference: string }

const member = (overrides: Overrides): NormalizedMember => ({
  name: overrides.canonicalReference,
  scopedName: overrides.canonicalReference,
  kind: "Property",
  isTopLevelExport: false,
  releaseTag: "public",
  isDeprecated: false,
  ...overrides,
})

const toMap = (members: readonly NormalizedMember[]) =>
  new Map(members.map((entry) => [entry.canonicalReference, entry]))

function classify(
  baseline: readonly NormalizedMember[],
  current: readonly NormalizedMember[],
  answer: "compatible" | "breaking" | "unknown" = "compatible",
) {
  const queries: AssignabilityQuery[] = []
  const result = classifyContractChanges(toMap(baseline), toMap(current), {
    resolveAssignability: (query) => {
      queries.push(query)
      return answer
    },
  })
  return { ...result, queries }
}

const only = (result: ReturnType<typeof classify>) => {
  expect(result.changes).toHaveLength(1)
  const [change] = result.changes
  if (!change) throw new Error("no change")
  return change
}

const func = (extra: Partial<NormalizedMember> = {}) =>
  member({
    canonicalReference: "pkg!f:function(1)",
    name: "f",
    scopedName: "f",
    kind: "Function",
    isTopLevelExport: true,
    overloadIndex: 1,
    parameters: [],
    returnTypeExcerptText: "void",
    ...extra,
  })

const param = (name: string, typeExcerptText: string, isOptional = false) => ({
  name,
  typeExcerptText,
  isOptional,
})

describe("members that are new or gone", () => {
  it("reports a top-level export added and removed", () => {
    const klass = member({
      canonicalReference: "pkg!A:class",
      scopedName: "A",
      kind: "Class",
      isTopLevelExport: true,
    })
    expect(classify([], [klass]).changes).toEqual([
      {
        id: "pkg!A:class#export-added",
        path: "A",
        kind: "export-added",
        compatibility: "compatible",
        explanation: "Added A.",
      },
    ])
    expect(classify([klass], []).changes).toEqual([
      {
        id: "pkg!A:class#export-removed",
        path: "A",
        kind: "export-removed",
        compatibility: "breaking",
        explanation: "Removed A.",
      },
    ])
  })

  it("reports a nested non-property member added and removed as an export", () => {
    const nested = member({
      canonicalReference: "pkg!A#m:member",
      scopedName: "A.m",
      kind: "Method",
    })
    expect(only(classify([], [nested]))).toEqual({
      id: "pkg!A#m:member#export-added",
      path: "A.m",
      kind: "export-added",
      compatibility: "compatible",
      explanation: "Added A.m.",
    })
    expect(only(classify([nested], []))).toEqual({
      id: "pkg!A#m:member#export-removed",
      path: "A.m",
      kind: "export-removed",
      compatibility: "breaking",
      explanation: "Removed A.m.",
    })
  })

  it("reports enum members added and removed", () => {
    const entry = member({
      canonicalReference: "pkg!E.X:member",
      scopedName: "E.X",
      kind: "EnumMember",
    })
    expect(only(classify([], [entry]))).toEqual({
      id: "pkg!E.X:member#enum-member-added",
      path: "E.X",
      kind: "enum-member-added",
      compatibility: "compatible",
      explanation: "Added enum member E.X.",
    })
    expect(only(classify([entry], []))).toEqual({
      id: "pkg!E.X:member#enum-member-removed",
      path: "E.X",
      kind: "enum-member-removed",
      compatibility: "breaking",
      explanation: "Removed enum member E.X.",
    })
  })

  it("reports a property added to an existing container by whether it is required", () => {
    const parent = member({
      canonicalReference: "pkg!I:interface",
      scopedName: "I",
      kind: "Interface",
      isTopLevelExport: true,
    })
    const required = member({
      canonicalReference: "pkg!I#p:member",
      scopedName: "I.p",
      parentCanonicalReference: "pkg!I:interface",
      propertyTypeExcerptText: "string",
      isOptional: false,
    })
    const optional = { ...required, isOptional: true }
    expect(only(classify([parent], [parent, required]))).toEqual({
      id: "pkg!I#p:member#property-added",
      path: "I.p",
      kind: "property-added",
      compatibility: "breaking",
      explanation: "Added required property I.p.",
    })
    expect(only(classify([parent], [parent, optional]))).toMatchObject({
      compatibility: "compatible",
      explanation: "Added optional property I.p.",
    })
  })

  it("does not call a required property breaking when its container is new too", () => {
    const parent = member({
      canonicalReference: "pkg!I:interface",
      scopedName: "I",
      kind: "Interface",
      isTopLevelExport: true,
    })
    const required = member({
      canonicalReference: "pkg!I#p:member",
      scopedName: "I.p",
      parentCanonicalReference: "pkg!I:interface",
      propertyTypeExcerptText: "string",
      isOptional: false,
    })
    const result = classify([], [parent, required])
    expect(result.changes.map((change) => change.kind)).toEqual(["export-added", "property-added"])
    expect(result.changes[1]).toMatchObject({
      compatibility: "compatible",
      explanation:
        "Added required property I.p (on a newly-added container, so not itself breaking).",
    })
    const orphan = { ...required, parentCanonicalReference: undefined }
    expect(only(classify([], [orphan])).compatibility).toBe("breaking")
  })

  it("reports a removed property", () => {
    const prop = member({
      canonicalReference: "pkg!I#p:member",
      scopedName: "I.p",
      propertyTypeExcerptText: "string",
    })
    expect(only(classify([prop], []))).toEqual({
      id: "pkg!I#p:member#property-removed",
      path: "I.p",
      kind: "property-removed",
      compatibility: "breaking",
      explanation: "Removed property I.p.",
    })
  })

  it("treats a non-overload kind with an overload index as an ordinary member", () => {
    const prop = member({
      canonicalReference: "pkg!I#p:member",
      scopedName: "I.p",
      kind: "Property",
      propertyTypeExcerptText: "string",
      overloadIndex: 1,
    })
    expect(only(classify([prop], [])).kind).toBe("property-removed")
  })

  it("treats a function with no overload index as an ordinary member", () => {
    const plain = member({
      canonicalReference: "pkg!g:function",
      scopedName: "g",
      kind: "Function",
      isTopLevelExport: true,
    })
    expect(only(classify([], [plain])).kind).toBe("export-added")
    expect(only(classify([plain], [])).kind).toBe("export-removed")
  })
})

describe("metadata", () => {
  const base = member({ canonicalReference: "pkg!x:member", scopedName: "x" })

  it("ranks release tags: widening is compatible, narrowing is breaking, equal is silent", () => {
    const cases: [string, string, "compatible" | "breaking"][] = [
      ["beta", "public", "compatible"],
      ["alpha", "beta", "compatible"],
      ["internal", "alpha", "compatible"],
      ["public", "beta", "breaking"],
      ["beta", "alpha", "breaking"],
      ["alpha", "internal", "breaking"],
    ]
    for (const [from, to, compatibility] of cases) {
      const result = classify(
        [{ ...base, releaseTag: from as never }],
        [{ ...base, releaseTag: to as never }],
      )
      expect(only(result), `${from} -> ${to}`).toEqual({
        id: "pkg!x:member#release-tag-changed",
        path: "x",
        kind: "release-tag-changed",
        compatibility,
        explanation: `x changed release tag from @${from} to @${to}.`,
      })
    }
    expect(classify([base], [base]).changes).toEqual([])
  })

  it("reports deprecation both ways", () => {
    expect(only(classify([base], [{ ...base, isDeprecated: true }]))).toEqual({
      id: "pkg!x:member#deprecation-changed",
      path: "x",
      kind: "deprecation-changed",
      compatibility: "compatible",
      explanation: "x was marked @deprecated.",
    })
    expect(only(classify([{ ...base, isDeprecated: true }], [base])).explanation).toBe(
      "x is no longer marked @deprecated.",
    )
  })

  it("flags a changed type-parameter list as unclassifiable", () => {
    expect(
      only(
        classify(
          [{ ...base, typeParameterNames: ["T"] }],
          [{ ...base, typeParameterNames: ["T", "U"] }],
        ),
      ),
    ).toEqual({
      id: "pkg!x:member#generic-parameter-changed",
      path: "x",
      kind: "generic-parameter-changed",
      compatibility: "unknown",
      explanation:
        "x's type parameters changed from [T] to [T, U] -- generic parameter changes are not safely classified automatically.",
    })
    expect(
      only(
        classify(
          [{ ...base, typeParameterNames: ["T", "U"] }],
          [{ ...base, typeParameterNames: ["T"] }],
        ),
      ).explanation,
    ).toContain("from [T, U] to [T] --")
    expect(only(classify([base], [{ ...base, typeParameterNames: ["T"] }])).explanation).toContain(
      "from [] to [T]",
    )
    expect(
      classify([{ ...base, typeParameterNames: ["T"] }], [{ ...base, typeParameterNames: ["T"] }])
        .changes,
    ).toEqual([])
  })

  it("flags a changed extends or implements clause, ignoring only the order of implements", () => {
    const heritage = {
      id: "pkg!x:member#heritage-changed",
      path: "x",
      kind: "heritage-changed",
      compatibility: "unknown",
      explanation:
        "x's extends/implements clause changed -- inheritance changes are not safely classified automatically.",
    }
    expect(
      only(
        classify(
          [{ ...base, extendsExcerptTexts: ["A"] }],
          [{ ...base, extendsExcerptTexts: ["B"] }],
        ),
      ),
    ).toEqual(heritage)
    expect(only(classify([base], [{ ...base, extendsExcerptTexts: ["A"] }]))).toEqual(heritage)
    expect(
      only(
        classify(
          [{ ...base, implementsExcerptTexts: ["A"] }],
          [{ ...base, implementsExcerptTexts: ["B"] }],
        ),
      ),
    ).toEqual(heritage)
    expect(only(classify([base], [{ ...base, implementsExcerptTexts: ["A"] }]))).toEqual(heritage)
    expect(
      only(
        classify(
          [{ ...base, extendsExcerptTexts: ["A"], implementsExcerptTexts: ["B"] }],
          [{ ...base, extendsExcerptTexts: ["B"], implementsExcerptTexts: ["A"] }],
        ),
      ),
    ).toEqual(heritage)
    expect(
      only(
        classify(
          [{ ...base, extendsExcerptTexts: ["A", "B"] }],
          [{ ...base, extendsExcerptTexts: ["B", "A"] }],
        ),
      ),
    ).toEqual(heritage)
    expect(
      classify(
        [{ ...base, implementsExcerptTexts: ["A", "B"] }],
        [{ ...base, implementsExcerptTexts: ["B", "A"] }],
      ).changes,
    ).toEqual([])
    expect(
      classify(
        [{ ...base, implementsExcerptTexts: ["B", "A"] }],
        [{ ...base, implementsExcerptTexts: ["A", "B"] }],
      ).changes,
    ).toEqual([])
  })
})

describe("enum members and type aliases", () => {
  it("reports a changed enum value, naming a missing one", () => {
    const entry = member({
      canonicalReference: "pkg!E.X:member",
      scopedName: "E.X",
      kind: "EnumMember",
      initializerExcerptText: "1",
    })
    expect(only(classify([entry], [{ ...entry, initializerExcerptText: "2" }]))).toEqual({
      id: "pkg!E.X:member#enum-member-changed",
      path: "E.X",
      kind: "enum-member-changed",
      compatibility: "breaking",
      explanation: "Enum member E.X changed value from 1 to 2.",
    })
    expect(
      only(classify([entry], [{ ...entry, initializerExcerptText: undefined }])).explanation,
    ).toBe("Enum member E.X changed value from 1 to (none).")
    expect(
      only(classify([{ ...entry, initializerExcerptText: undefined }], [entry])).explanation,
    ).toBe("Enum member E.X changed value from (none) to 1.")
    expect(classify([entry], [entry]).changes).toEqual([])
  })

  it("ignores an initializer change on anything that is not an enum member", () => {
    const prop = member({ canonicalReference: "pkg!p:member", initializerExcerptText: "1" })
    expect(classify([prop], [{ ...prop, initializerExcerptText: "2" }]).changes).toEqual([])
  })

  it("asks the resolver about a changed alias, invariantly, and reports its verdict", () => {
    const alias = member({
      canonicalReference: "pkg!T:type",
      scopedName: "T",
      kind: "TypeAlias",
      typeAliasExcerptText: "string",
    })
    for (const verdict of ["compatible", "breaking", "unknown"] as const) {
      const result = classify([alias], [{ ...alias, typeAliasExcerptText: "number" }], verdict)
      expect(only(result)).toEqual({
        id: "pkg!T:type#type-alias-changed",
        path: "T",
        kind: "type-alias-changed",
        compatibility: verdict,
        explanation: "Type alias T changed from `string` to `number`.",
      })
      expect(result.queries).toEqual([
        {
          oldCanonicalReference: "pkg!T:type",
          newCanonicalReference: "pkg!T:type",
          position: "type-alias",
          direction: "invariant",
        },
      ])
    }
    expect(classify([alias], [alias]).changes).toEqual([])
  })

  it("compares an alias only when both sides have one", () => {
    const alias = member({ canonicalReference: "pkg!T:type", typeAliasExcerptText: "string" })
    const none = member({ canonicalReference: "pkg!T:type" })
    expect(classify([alias], [none])).toMatchObject({ changes: [], queries: [] })
    expect(classify([none], [alias])).toMatchObject({ changes: [], queries: [] })
  })
})

describe("properties and variables", () => {
  const prop = member({
    canonicalReference: "pkg!I#p:member",
    scopedName: "I.p",
    propertyTypeExcerptText: "string",
    isOptional: false,
    isReadonly: false,
  })

  it("reports optionality and mutability both ways", () => {
    expect(only(classify([prop], [{ ...prop, isOptional: true }]))).toEqual({
      id: "pkg!I#p:member#property-optionality-changed",
      path: "I.p",
      kind: "property-optionality-changed",
      compatibility: "compatible",
      explanation: "Property I.p became optional.",
    })
    expect(only(classify([{ ...prop, isOptional: true }], [prop]))).toMatchObject({
      compatibility: "breaking",
      explanation: "Property I.p became required.",
    })
    expect(only(classify([prop], [{ ...prop, isReadonly: true }]))).toEqual({
      id: "pkg!I#p:member#property-readonly-changed",
      path: "I.p",
      kind: "property-readonly-changed",
      compatibility: "compatible",
      explanation: "Property I.p became readonly.",
    })
    expect(only(classify([{ ...prop, isReadonly: true }], [prop]))).toMatchObject({
      compatibility: "breaking",
      explanation: "Property I.p became mutable.",
    })
  })

  it("asks the resolver about a changed property type: covariantly when readonly, invariantly otherwise", () => {
    const mutable = classify([prop], [{ ...prop, propertyTypeExcerptText: "number" }], "breaking")
    expect(only(mutable)).toEqual({
      id: "pkg!I#p:member#property-type-changed",
      path: "I.p",
      kind: "property-type-changed",
      compatibility: "breaking",
      explanation: "Property I.p changed from `string` to `number`.",
    })
    expect(mutable.queries).toEqual([
      {
        oldCanonicalReference: "pkg!I#p:member",
        newCanonicalReference: "pkg!I#p:member",
        position: "property",
        direction: "invariant",
      },
    ])
    const readonly = classify(
      [{ ...prop, isReadonly: true }],
      [{ ...prop, isReadonly: true, propertyTypeExcerptText: "number" }],
    )
    expect(readonly.queries[0]?.direction).toBe("covariant")
    expect(classify([prop], [prop]).changes).toEqual([])
  })

  it("compares a property only when both sides carry a type", () => {
    const untyped = member({ canonicalReference: "pkg!I#p:member", isOptional: true })
    expect(classify([prop], [{ ...untyped }])).toMatchObject({ changes: [], queries: [] })
    expect(classify([{ ...untyped }], [prop])).toMatchObject({ changes: [], queries: [] })
  })

  it("reports a changed variable type, as a property-type change with the variable's wording", () => {
    const variable = member({
      canonicalReference: "pkg!V:variable",
      scopedName: "V",
      kind: "Variable",
      isTopLevelExport: true,
      variableTypeExcerptText: "string",
      isReadonly: false,
    })
    const result = classify(
      [variable],
      [{ ...variable, variableTypeExcerptText: "number" }],
      "unknown",
    )
    expect(only(result)).toEqual({
      id: "pkg!V:variable#property-type-changed",
      path: "V",
      kind: "property-type-changed",
      compatibility: "unknown",
      explanation: "Variable V changed from `string` to `number`.",
    })
    expect(result.queries).toEqual([
      {
        oldCanonicalReference: "pkg!V:variable",
        newCanonicalReference: "pkg!V:variable",
        position: "variable",
        direction: "invariant",
      },
    ])
    const constant = classify(
      [{ ...variable, isReadonly: true }],
      [{ ...variable, isReadonly: true, variableTypeExcerptText: "number" }],
    )
    expect(constant.queries[0]?.direction).toBe("covariant")
    const untyped = member({ canonicalReference: "pkg!V:variable" })
    expect(classify([variable], [untyped])).toMatchObject({ changes: [], queries: [] })
    expect(classify([untyped], [variable])).toMatchObject({ changes: [], queries: [] })
  })
})

describe("signatures", () => {
  it("reports parameters added, removed, made optional or required, and retyped, each under its own index", () => {
    const baseline = func({ parameters: [param("a", "string"), param("b", "number")] })
    const added = classify(
      [baseline],
      [func({ parameters: [param("a", "string"), param("b", "number"), param("c", "boolean")] })],
    )
    expect(only(added)).toEqual({
      id: "pkg!f:function(1)#parameter-added#param-2",
      path: "f",
      kind: "parameter-added",
      compatibility: "breaking",
      explanation: "Added required parameter `c` to f.",
    })
    const addedOptional = classify(
      [baseline],
      [
        func({
          parameters: [param("a", "string"), param("b", "number"), param("c", "boolean", true)],
        }),
      ],
    )
    expect(only(addedOptional)).toMatchObject({
      compatibility: "compatible",
      explanation: "Added optional parameter `c` to f.",
    })

    const removed = classify([baseline], [func({ parameters: [param("a", "string")] })])
    expect(only(removed)).toEqual({
      id: "pkg!f:function(1)#parameter-removed#param-1",
      path: "f",
      kind: "parameter-removed",
      compatibility: "breaking",
      explanation: "Removed parameter `b` from f.",
    })
    const removedTwo = classify([baseline], [func({ parameters: [] })])
    expect(removedTwo.changes.map((change) => change.id)).toEqual([
      "pkg!f:function(1)#parameter-removed#param-0",
      "pkg!f:function(1)#parameter-removed#param-1",
    ])

    const optional = classify(
      [baseline],
      [func({ parameters: [param("a", "string", true), param("b", "number")] })],
    )
    expect(only(optional)).toEqual({
      id: "pkg!f:function(1)#parameter-optionality-changed#param-0",
      path: "f",
      kind: "parameter-optionality-changed",
      compatibility: "compatible",
      explanation: "Parameter `a` of f became optional.",
    })
    const required = classify(
      [func({ parameters: [param("a", "string", true)] })],
      [func({ parameters: [param("a", "string")] })],
    )
    expect(only(required)).toMatchObject({
      compatibility: "breaking",
      explanation: "Parameter `a` of f became required.",
    })

    const retyped = classify(
      [baseline],
      [func({ parameters: [param("a", "string"), param("b", "bigint")] })],
      "breaking",
    )
    expect(only(retyped)).toEqual({
      id: "pkg!f:function(1)#parameter-type-changed#param-1",
      path: "f",
      kind: "parameter-type-changed",
      compatibility: "breaking",
      explanation: "Parameter `b` of f changed from `number` to `bigint`.",
    })
    expect(retyped.queries).toEqual([
      {
        oldCanonicalReference: "pkg!f:function(1)",
        newCanonicalReference: "pkg!f:function(1)",
        position: "parameter",
        parameterIndex: 1,
        direction: "contravariant",
      },
    ])
    expect(classify([baseline], [baseline]).changes).toEqual([])
  })

  it("reports both an optionality and a type change on the same parameter", () => {
    const result = classify(
      [func({ parameters: [param("a", "string")] })],
      [func({ parameters: [param("a", "number", true)] })],
    )
    expect(result.changes.map((change) => change.kind)).toEqual([
      "parameter-optionality-changed",
      "parameter-type-changed",
    ])
  })

  it("asks the resolver about a changed return type, covariantly", () => {
    const result = classify([func()], [func({ returnTypeExcerptText: "string" })], "unknown")
    expect(only(result)).toEqual({
      id: "pkg!f:function(1)#return-type-changed",
      path: "f",
      kind: "return-type-changed",
      compatibility: "unknown",
      explanation: "f's return type changed from `void` to `string`.",
    })
    expect(result.queries).toEqual([
      {
        oldCanonicalReference: "pkg!f:function(1)",
        newCanonicalReference: "pkg!f:function(1)",
        position: "return",
        direction: "covariant",
      },
    ])
  })

  it("compares parameters and return types only when both sides carry them", () => {
    const bare = func({ parameters: undefined, returnTypeExcerptText: undefined })
    const full = func({ parameters: [param("a", "string")] })
    expect(classify([bare], [full])).toMatchObject({ changes: [], queries: [] })
    expect(classify([full], [bare])).toMatchObject({ changes: [], queries: [] })
    expect(
      classify(
        [func({ parameters: undefined })],
        [func({ parameters: undefined, returnTypeExcerptText: "string" })],
      ).changes,
    ).toHaveLength(1)
    expect(classify([bare], [func()])).toMatchObject({ changes: [], queries: [] })
    expect(classify([func()], [bare])).toMatchObject({ changes: [], queries: [] })
  })
})

describe("overload sets", () => {
  const overload = (
    index: number,
    parameters: ReturnType<typeof param>[],
    extra: Partial<NormalizedMember> = {},
  ) =>
    func({
      canonicalReference: `pkg!f:function(${String(index)})`,
      overloadIndex: index,
      parameters,
      ...extra,
    })

  it("reports a wholly new or wholly removed overload set once", () => {
    const one = overload(1, [param("a", "string")])
    const two = overload(2, [param("a", "number")])
    expect(classify([], [one, two]).changes).toEqual([
      {
        id: "pkg!f:function(1)#export-added",
        path: "f",
        kind: "export-added",
        compatibility: "compatible",
        explanation: "Added f.",
      },
    ])
    expect(classify([one, two], []).changes).toEqual([
      {
        id: "pkg!f:function(1)#export-removed",
        path: "f",
        kind: "export-removed",
        compatibility: "breaking",
        explanation: "Removed f.",
      },
    ])
  })

  it("matches overloads by parameter signature, reporting those removed and added", () => {
    const a = overload(1, [param("a", "string"), param("b", "number", true)])
    const b = overload(2, [param("a", "number")])
    const c = overload(2, [param("a", "boolean")])
    const result = classify([a, b], [a, c])
    expect(result.changes).toEqual([
      {
        id: "pkg!f:function(2)#overload-added",
        path: "f",
        kind: "overload-added",
        compatibility: "compatible",
        explanation: "Added overload f(a:boolean).",
      },
      {
        id: "pkg!f:function(2)#overload-removed",
        path: "f",
        kind: "overload-removed",
        compatibility: "breaking",
        explanation: "Removed overload f(a:number).",
      },
    ])
    expect(classify([a, b], [a, b]).changes).toEqual([])
    const signed = classify([a, b], [b])
    expect(only(signed).explanation).toBe("Removed overload f(a:string,b?:number).")
  })

  it("compares a matched overload in full, not only its return type", () => {
    const a = overload(1, [param("a", "string")])
    const b = overload(2, [param("a", "number")])
    const result = classify([a, b], [a, { ...b, isDeprecated: true }])
    expect(only(result).kind).toBe("deprecation-changed")
    const widened = classify([a, b], [a, { ...b, returnTypeExcerptText: "string" }])
    expect(only(widened).kind).toBe("return-type-changed")
  })

  it("compares the lone overload on each side as an ordinary member", () => {
    const result = classify(
      [overload(1, [param("a", "string")])],
      [overload(1, [param("a", "number")])],
    )
    expect(only(result).kind).toBe("parameter-type-changed")
  })

  it("does not compare a single overload with a pair as though it were one", () => {
    const a = overload(1, [param("a", "string")])
    const b = overload(2, [param("a", "number")])
    const result = classify([a, b], [overload(1, [param("a", "boolean")])])
    expect(result.changes.map((change) => change.kind).sort()).toEqual([
      "overload-added",
      "overload-removed",
      "overload-removed",
    ])
  })

  it("treats one overload against two as a set comparison, whichever side has the pair", () => {
    const a = overload(1, [param("a", "string")])
    const b = overload(2, [param("a", "number")])
    const grown = classify([a], [a, b])
    expect(only(grown)).toMatchObject({
      kind: "overload-added",
      explanation: "Added overload f(a:number).",
    })
    const shrunk = classify([a, b], [a])
    expect(only(shrunk)).toMatchObject({
      kind: "overload-removed",
      explanation: "Removed overload f(a:number).",
    })
  })

  it("matches signatures of members with and without a parameter list as the same empty signature", () => {
    const bare = (suffix: string, parameters: ReturnType<typeof param>[] | undefined) =>
      member({
        canonicalReference: `pkg!A:call(${suffix})`,
        name: undefined,
        scopedName: "A",
        kind: "CallSignature",
        overloadIndex: 1,
        parameters,
      })
    const named = bare("2", [param("a", "string")])
    expect(classify([bare("1", undefined), named], [bare("1", []), named]).changes).toEqual([])
  })

  it("does not group functions that have no overload index", () => {
    const plain = (suffix: string, type: string) =>
      member({
        canonicalReference: `pkg!f:function(${suffix})`,
        name: "f",
        scopedName: "f",
        kind: "Function",
        isTopLevelExport: true,
        parameters: [param("a", type)],
        returnTypeExcerptText: "void",
      })
    const result = classify([plain("1", "string"), plain("2", "number")], [plain("1", "boolean")])
    expect(result.changes.map((change) => change.kind)).toEqual([
      "parameter-type-changed",
      "export-removed",
    ])
  })

  it("keeps overload sets with different parents, names or kinds apart", () => {
    const method = (parent: string | undefined, name: string, kind: string) =>
      member({
        canonicalReference: `${parent ?? "root"}!${name}:${kind}(1)`,
        name,
        scopedName: name,
        kind,
        parentCanonicalReference: parent,
        overloadIndex: 1,
        parameters: [param("a", "string")],
      })
    const sets = [
      method("A", "m", "Method"),
      method("B", "m", "Method"),
      method("A", "n", "Method"),
      method("A", "m", "MethodSignature"),
      method(undefined, "m", "Method"),
    ]
    expect(classify([], sets).changes).toHaveLength(5)
    expect(classify(sets, []).changes).toHaveLength(5)
    const unnamed = (suffix: string) =>
      member({
        canonicalReference: `pkg!A:call(${suffix})`,
        name: undefined,
        scopedName: "A",
        kind: "CallSignature",
        overloadIndex: 1,
        parameters: undefined,
      })
    expect(classify([], [unnamed("1")]).changes).toHaveLength(1)
    const withoutParams = classify([unnamed("1"), unnamed("2")], [unnamed("1"), unnamed("2")])
    expect(withoutParams.changes).toEqual([])
  })
})

describe("the result", () => {
  it("lists changes sorted by id, whatever order the maps came in", () => {
    const z = member({
      canonicalReference: "pkg!z:class",
      scopedName: "z",
      kind: "Class",
      isTopLevelExport: true,
    })
    const a = member({
      canonicalReference: "pkg!a:class",
      scopedName: "a",
      kind: "Class",
      isTopLevelExport: true,
    })
    const b = member({
      canonicalReference: "pkg!b:class",
      scopedName: "b",
      kind: "Class",
      isTopLevelExport: true,
    })
    expect(classify([], [z, a, b]).changes.map((change) => change.id)).toEqual([
      "pkg!a:class#export-added",
      "pkg!b:class#export-added",
      "pkg!z:class#export-added",
    ])
    expect(classify([b], [z, a]).changes.map((change) => change.id)).toEqual([
      "pkg!a:class#export-added",
      "pkg!b:class#export-removed",
      "pkg!z:class#export-added",
    ])
  })

  it("takes the worst impact: breaking over unknown over compatible over unchanged", () => {
    const klass = (name: string) =>
      member({
        canonicalReference: `pkg!${name}:class`,
        scopedName: name,
        kind: "Class",
        isTopLevelExport: true,
      })
    const generic = member({
      canonicalReference: "pkg!g:member",
      scopedName: "g",
      typeParameterNames: ["T"],
    })
    const genericChanged = { ...generic, typeParameterNames: ["T", "U"] }
    expect(classify([], []).impact).toBe("unchanged")
    expect(classify([], [klass("a")]).impact).toBe("compatible")
    expect(classify([generic], [genericChanged]).impact).toBe("unknown")
    expect(classify([generic], [genericChanged, klass("a")]).impact).toBe("unknown")
    expect(classify([generic, klass("a")], [genericChanged]).impact).toBe("breaking")
    expect(classify([klass("a")], []).impact).toBe("breaking")
    expect(classify([klass("a")], [klass("b")]).impact).toBe("breaking")
  })
})
