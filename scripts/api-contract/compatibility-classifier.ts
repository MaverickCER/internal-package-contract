import type { ApiContractChange, ChangeKind, ContractImpact } from "./evidence-types.js"
import type { NormalizedMember, ReleaseTagLevel } from "./model-normalizer.js"

/**
 * Ported from repo-contract's own `scripts/api-contract/compatibility-classifier.ts` -- this engine
 * now lives only here (see `checks/api-contract.ts`'s own note); repo-contract consumes it as a
 * devDependency rather than hosting a copy.
 *
 * Pure diff over two normalized maps -- zero API-Extractor/TypeScript imports, so this module is
 * testable with a fake `resolveAssignability` (fast, synchronous unit tests) while check.ts wires
 * in the real TypeChecker-backed resolver from type-assignability.ts. Implements every
 * deterministic rule from the compatibility-analysis requirements directly from normalized-map
 * facts; only reaches into `resolveAssignability` when a type-bearing position's rendered excerpt
 * text literally changed between baseline and current.
 */

const RELEASE_TAG_RANK: Record<ReleaseTagLevel, number> = {
  internal: 0,
  alpha: 1,
  beta: 2,
  public: 3,
}

export type AssignabilityDirection = "contravariant" | "covariant" | "invariant"

export interface AssignabilityQuery {
  readonly oldCanonicalReference: string
  readonly newCanonicalReference: string
  readonly position: "parameter" | "return" | "property" | "variable" | "type-alias"
  readonly parameterIndex?: number
  readonly direction: AssignabilityDirection
}

export type ResolveAssignability = (
  query: AssignabilityQuery,
) => "compatible" | "breaking" | "unknown"

interface ClassifyOptions {
  readonly resolveAssignability: ResolveAssignability
}

interface ClassifyResult {
  readonly changes: readonly ApiContractChange[]
  readonly impact: ContractImpact
}

const IMPACT_RANK: Record<ContractImpact, number> = {
  unchanged: 0,
  compatible: 1,
  unknown: 2,
  breaking: 3,
}

/**
 * @param changes - The accumulator array to append the new change onto.
 * @param member - The member (usually the current side) the change is reported against.
 * @param kind - The category of change being recorded.
 * @param compatibility - Whether this change is compatible, breaking, or could not be safely classified.
 * @param explanation - Human-readable description of what changed.
 * @param idSuffix - Appended after the kind to keep the change's `id` unique, e.g. distinguishing one parameter among several.
 */
function push(
  changes: ApiContractChange[],
  member: NormalizedMember,
  kind: ChangeKind,
  compatibility: ApiContractChange["compatibility"],
  explanation: string,
  idSuffix = "",
): void {
  changes.push({
    // `kind` is part of the id: one member can emit several genuinely distinct
    // changes at once (e.g. a release-tag change *and* a property-type change),
    // and keying only on `canonicalReference` collided them into one id.
    id: `${member.canonicalReference}#${kind}${idSuffix}`,
    path: member.scopedName,
    kind,
    compatibility,
    explanation,
  })
}

/**
 * @param baselineMember - The member's normalized form on the baseline side.
 * @param currentMember - The same member's normalized form on the current side.
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any parameter changes onto.
 */
function compareParameters(
  baselineMember: NormalizedMember,
  currentMember: NormalizedMember,
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
): void {
  const oldParams = baselineMember.parameters ?? []
  const newParams = currentMember.parameters ?? []
  const maxLength = Math.max(oldParams.length, newParams.length)

  for (let i = 0; i < maxLength; i++) {
    const oldParam = oldParams[i]
    const newParam = newParams[i]

    if (!oldParam && newParam) {
      push(
        changes,
        currentMember,
        "parameter-added",
        newParam.isOptional ? "compatible" : "breaking",
        `Added ${newParam.isOptional ? "optional" : "required"} parameter \`${newParam.name}\` to ${currentMember.scopedName}.`,
        `#param-${String(i)}`,
      )
      continue
    }
    if (oldParam && !newParam) {
      push(
        changes,
        currentMember,
        "parameter-removed",
        "breaking",
        `Removed parameter \`${oldParam.name}\` from ${currentMember.scopedName}.`,
        `#param-${String(i)}`,
      )
      continue
    }
    if (!oldParam || !newParam) continue

    if (oldParam.isOptional !== newParam.isOptional) {
      push(
        changes,
        currentMember,
        "parameter-optionality-changed",
        newParam.isOptional ? "compatible" : "breaking",
        `Parameter \`${newParam.name}\` of ${currentMember.scopedName} became ${newParam.isOptional ? "optional" : "required"}.`,
        `#param-${String(i)}`,
      )
    }

    if (oldParam.typeExcerptText !== newParam.typeExcerptText) {
      const result = resolve({
        oldCanonicalReference: baselineMember.canonicalReference,
        newCanonicalReference: currentMember.canonicalReference,
        position: "parameter",
        parameterIndex: i,
        direction: "contravariant",
      })
      push(
        changes,
        currentMember,
        "parameter-type-changed",
        result,
        `Parameter \`${newParam.name}\` of ${currentMember.scopedName} changed from \`${oldParam.typeExcerptText}\` to \`${newParam.typeExcerptText}\`.`,
        `#param-${String(i)}`,
      )
    }
  }
}

/**
 * Release tag, deprecation, type parameters and heritage.
 * @param baselineMember - The member's normalized form on the baseline side.
 * @param currentMember - The same member's normalized form on the current side.
 * @param changes - The accumulator array to append any detected changes onto.
 */
function compareMetadata(
  baselineMember: NormalizedMember,
  currentMember: NormalizedMember,
  changes: ApiContractChange[],
): void {
  if (baselineMember.releaseTag !== currentMember.releaseTag) {
    const narrowed =
      RELEASE_TAG_RANK[currentMember.releaseTag] < RELEASE_TAG_RANK[baselineMember.releaseTag]
    push(
      changes,
      currentMember,
      "release-tag-changed",
      narrowed ? "breaking" : "compatible",
      `${currentMember.scopedName} changed release tag from @${baselineMember.releaseTag} to @${currentMember.releaseTag}.`,
    )
  }

  if (baselineMember.isDeprecated !== currentMember.isDeprecated) {
    push(
      changes,
      currentMember,
      "deprecation-changed",
      "compatible",
      `${currentMember.scopedName} ${currentMember.isDeprecated ? "was marked" : "is no longer marked"} @deprecated.`,
    )
  }

  const oldTypeParams = baselineMember.typeParameterNames ?? []
  const newTypeParams = currentMember.typeParameterNames ?? []
  if (JSON.stringify(oldTypeParams) !== JSON.stringify(newTypeParams)) {
    push(
      changes,
      currentMember,
      "generic-parameter-changed",
      "unknown",
      `${currentMember.scopedName}'s type parameters changed from [${oldTypeParams.join(", ")}] to [${newTypeParams.join(", ")}] -- generic parameter changes are not safely classified automatically.`,
    )
  }

  // `extends` and `implements` are compared as two separate ordered lists,
  // not merged-and-sorted into one: relocating a type between the two
  // clauses (`class C extends A implements B` -> `class C extends B
  // implements A`) leaves the merged set identical while genuinely changing
  // the inheritance relationship. `extends` order is kept (a class has at
  // most one, an interface's `extends` order is not semantically meaningful
  // but a reorder is still worth surfacing as `unknown`); `implements` is
  // sorted because its order carries no meaning.
  const oldExtends = baselineMember.extendsExcerptTexts ?? []
  const newExtends = currentMember.extendsExcerptTexts ?? []
  const oldImplements = [...(baselineMember.implementsExcerptTexts ?? [])].sort()
  const newImplements = [...(currentMember.implementsExcerptTexts ?? [])].sort()
  if (JSON.stringify([oldExtends, oldImplements]) !== JSON.stringify([newExtends, newImplements])) {
    push(
      changes,
      currentMember,
      "heritage-changed",
      "unknown",
      `${currentMember.scopedName}'s extends/implements clause changed -- inheritance changes are not safely classified automatically.`,
    )
  }
}

/**
 * An enum member's value and a type alias's definition.
 * @param baselineMember - The member's normalized form on the baseline side.
 * @param currentMember - The same member's normalized form on the current side.
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any detected changes onto.
 */
function compareEnumAndAlias(
  baselineMember: NormalizedMember,
  currentMember: NormalizedMember,
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
): void {
  if (
    currentMember.kind === "EnumMember" &&
    baselineMember.initializerExcerptText !== currentMember.initializerExcerptText
  ) {
    push(
      changes,
      currentMember,
      "enum-member-changed",
      "breaking",
      `Enum member ${currentMember.scopedName} changed value from ${baselineMember.initializerExcerptText ?? "(none)"} to ${currentMember.initializerExcerptText ?? "(none)"}.`,
    )
  }

  if (
    baselineMember.typeAliasExcerptText !== undefined &&
    currentMember.typeAliasExcerptText !== undefined
  ) {
    if (baselineMember.typeAliasExcerptText !== currentMember.typeAliasExcerptText) {
      const result = resolve({
        oldCanonicalReference: baselineMember.canonicalReference,
        newCanonicalReference: currentMember.canonicalReference,
        position: "type-alias",
        direction: "invariant",
      })
      push(
        changes,
        currentMember,
        "type-alias-changed",
        result,
        `Type alias ${currentMember.scopedName} changed from \`${baselineMember.typeAliasExcerptText}\` to \`${currentMember.typeAliasExcerptText}\`.`,
      )
    }
  }
}

/**
 * A property's optionality, mutability and type.
 * @param baselineMember - The member's normalized form on the baseline side.
 * @param currentMember - The same member's normalized form on the current side.
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any detected changes onto.
 */
function compareProperty(
  baselineMember: NormalizedMember,
  currentMember: NormalizedMember,
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
): void {
  if (
    baselineMember.propertyTypeExcerptText !== undefined &&
    currentMember.propertyTypeExcerptText !== undefined
  ) {
    if (baselineMember.isOptional !== currentMember.isOptional) {
      push(
        changes,
        currentMember,
        "property-optionality-changed",
        currentMember.isOptional ? "compatible" : "breaking",
        `Property ${currentMember.scopedName} became ${currentMember.isOptional ? "optional" : "required"}.`,
      )
    }
    if (baselineMember.isReadonly !== currentMember.isReadonly) {
      push(
        changes,
        currentMember,
        "property-readonly-changed",
        currentMember.isReadonly ? "compatible" : "breaking",
        `Property ${currentMember.scopedName} became ${currentMember.isReadonly ? "readonly" : "mutable"}.`,
      )
    }
    if (baselineMember.propertyTypeExcerptText !== currentMember.propertyTypeExcerptText) {
      const direction: AssignabilityDirection = currentMember.isReadonly ? "covariant" : "invariant"
      const result = resolve({
        oldCanonicalReference: baselineMember.canonicalReference,
        newCanonicalReference: currentMember.canonicalReference,
        position: "property",
        direction,
      })
      push(
        changes,
        currentMember,
        "property-type-changed",
        result,
        `Property ${currentMember.scopedName} changed from \`${baselineMember.propertyTypeExcerptText}\` to \`${currentMember.propertyTypeExcerptText}\`.`,
      )
    }
  }
}

/**
 * An exported variable's type.
 * @param baselineMember - The member's normalized form on the baseline side.
 * @param currentMember - The same member's normalized form on the current side.
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any detected changes onto.
 */
function compareVariable(
  baselineMember: NormalizedMember,
  currentMember: NormalizedMember,
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
): void {
  if (
    baselineMember.variableTypeExcerptText !== undefined &&
    currentMember.variableTypeExcerptText !== undefined
  ) {
    if (baselineMember.variableTypeExcerptText !== currentMember.variableTypeExcerptText) {
      const direction: AssignabilityDirection = currentMember.isReadonly ? "covariant" : "invariant"
      const result = resolve({
        oldCanonicalReference: baselineMember.canonicalReference,
        newCanonicalReference: currentMember.canonicalReference,
        position: "variable",
        direction,
      })
      push(
        changes,
        currentMember,
        "property-type-changed",
        result,
        `Variable ${currentMember.scopedName} changed from \`${baselineMember.variableTypeExcerptText}\` to \`${currentMember.variableTypeExcerptText}\`.`,
      )
    }
  }
}

/**
 * Parameters and the return type.
 * @param baselineMember - The member's normalized form on the baseline side.
 * @param currentMember - The same member's normalized form on the current side.
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any detected changes onto.
 */
function compareSignature(
  baselineMember: NormalizedMember,
  currentMember: NormalizedMember,
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
): void {
  if (baselineMember.parameters !== undefined && currentMember.parameters !== undefined) {
    compareParameters(baselineMember, currentMember, resolve, changes)
  }

  if (
    baselineMember.returnTypeExcerptText !== undefined &&
    currentMember.returnTypeExcerptText !== undefined
  ) {
    if (baselineMember.returnTypeExcerptText !== currentMember.returnTypeExcerptText) {
      const result = resolve({
        oldCanonicalReference: baselineMember.canonicalReference,
        newCanonicalReference: currentMember.canonicalReference,
        position: "return",
        direction: "covariant",
      })
      push(
        changes,
        currentMember,
        "return-type-changed",
        result,
        `${currentMember.scopedName}'s return type changed from \`${baselineMember.returnTypeExcerptText}\` to \`${currentMember.returnTypeExcerptText}\`.`,
      )
    }
  }
}

/**
 * @param baselineMember - The member's normalized form on the baseline side.
 * @param currentMember - The same member's normalized form on the current side.
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any detected changes onto.
 */
function compareMatchedMember(
  baselineMember: NormalizedMember,
  currentMember: NormalizedMember,
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
): void {
  compareMetadata(baselineMember, currentMember, changes)
  compareEnumAndAlias(baselineMember, currentMember, resolve, changes)
  compareProperty(baselineMember, currentMember, resolve, changes)
  compareVariable(baselineMember, currentMember, resolve, changes)
  compareSignature(baselineMember, currentMember, resolve, changes)
}

const OVERLOAD_KINDS = new Set([
  "Function",
  "Method",
  "MethodSignature",
  "Constructor",
  "ConstructSignature",
  "CallSignature",
])

/**
 * @param member - The overloaded member to derive a signature for.
 * @returns A comma-joined `name?:type` string per parameter, used to match overloads across baseline and current by shape rather than position.
 */
function parameterSignature(member: NormalizedMember): string {
  return (member.parameters ?? [])
    .map((p) => `${p.name}${p.isOptional ? "?" : ""}:${p.typeExcerptText}`)
    .join(",")
}

/**
 * @param member - The member to compute a grouping key for.
 * @returns A key identifying the overload set `member` belongs to (its parent, name, and kind).
 */
function groupKey(member: NormalizedMember): string {
  return `${member.parentCanonicalReference ?? ""}::${member.name ?? ""}::${member.kind}`
}

/**
 * Groups every overloadable member of `map` by the overload set it belongs to.
 * @param map - All normalized members on one side, keyed by canonical reference.
 * @param handled - Canonical references of overloadable members, recorded so the caller's later, position-based pass skips them.
 * @returns The members of each overload set, keyed by {@link groupKey}.
 */
function groupOverloads(
  map: ReadonlyMap<string, NormalizedMember>,
  handled: Set<string>,
): Map<string, NormalizedMember[]> {
  const groups = new Map<string, NormalizedMember[]>()
  for (const member of map.values()) {
    if (member.overloadIndex === undefined || !OVERLOAD_KINDS.has(member.kind)) continue
    handled.add(member.canonicalReference)
    const key = groupKey(member)
    const group = groups.get(key) ?? []
    group.push(member)
    groups.set(key, group)
  }
  return groups
}

/**
 * Compares two multi-overload sets, matching overloads by exact parameter-list signature.
 * @param baselineGroup - The overloads on the baseline side.
 * @param currentGroup - The overloads on the current side.
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any detected changes onto.
 */
function compareOverloadSets(
  baselineGroup: readonly NormalizedMember[],
  currentGroup: readonly NormalizedMember[],
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
): void {
  const baselineBySignature = new Map(baselineGroup.map((m) => [parameterSignature(m), m]))
  const currentBySignature = new Map(currentGroup.map((m) => [parameterSignature(m), m]))

  for (const [signature, oldMember] of baselineBySignature) {
    const newMember = currentBySignature.get(signature)
    if (!newMember) {
      push(
        changes,
        oldMember,
        "overload-removed",
        "breaking",
        `Removed overload ${oldMember.scopedName}(${signature}).`,
      )
      continue
    }
    // A signature-matched overload is compared with the full per-member comparison, not only its
    // return type: a release-tag narrowing (@public -> @internal), a new @deprecated, or a
    // type-parameter change on a single overload of a multi-overload set is just as breaking as it
    // is on a non-overloaded function.
    compareMatchedMember(oldMember, newMember, resolve, changes)
  }
  for (const [signature, newMember] of currentBySignature) {
    if (!baselineBySignature.has(signature)) {
      push(
        changes,
        newMember,
        "overload-added",
        "compatible",
        `Added overload ${newMember.scopedName}(${signature}).`,
      )
    }
  }
}

/**
 * Compares one overload set across baseline and current.
 * @param baselineGroup - The overloads on the baseline side (possibly none).
 * @param currentGroup - The overloads on the current side (possibly none).
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any detected changes onto.
 */
function classifyOverloadSet(
  baselineGroup: readonly NormalizedMember[],
  currentGroup: readonly NormalizedMember[],
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
): void {
  // An entirely-new (or entirely-removed) overload set is reported once, for the whole
  // function/method, regardless of how many overloads it has -- not as N bare `overload-added`
  // entries with no `export-added` among them.
  const first = currentGroup[0]
  const removed = baselineGroup[0]
  if (baselineGroup.length === 0 && first) {
    push(changes, first, "export-added", "compatible", `Added ${first.scopedName}.`)
    return
  }
  if (currentGroup.length === 0 && removed) {
    push(changes, removed, "export-removed", "breaking", `Removed ${removed.scopedName}.`)
    return
  }
  if (baselineGroup.length === 1 && currentGroup.length === 1 && removed && first) {
    compareMatchedMember(removed, first, resolve, changes)
    return
  }
  compareOverloadSets(baselineGroup, currentGroup, resolve, changes)
}

/**
 * Handles every member with `overloadIndex !== undefined`. The overwhelmingly common case -- a
 * single (non-overloaded) function/method on each side -- is compared directly by position, so an
 * ordinary parameter/return-type change is reported with the normal, specific change kinds rather
 * than as a coarse overload add+remove. Genuine multi-overload sets are matched *within* their
 * group by exact parameter-list signature text rather than positional `overloadIndex` (inserting a
 * new first overload would otherwise shift every later overload's identity and misreport it as
 * removed+added).
 * @param baselineMap - All normalized members on the baseline side, keyed by canonical reference.
 * @param currentMap - All normalized members on the current side, keyed by canonical reference.
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any detected changes onto.
 * @param handled - Canonical references of overloadable members this pass has processed, so the caller's later, position-based pass skips them.
 */
function classifyOverloadable(
  baselineMap: ReadonlyMap<string, NormalizedMember>,
  currentMap: ReadonlyMap<string, NormalizedMember>,
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
  handled: Set<string>,
): void {
  const baselineByGroup = groupOverloads(baselineMap, handled)
  const currentByGroup = groupOverloads(currentMap, handled)
  for (const key of new Set([...baselineByGroup.keys(), ...currentByGroup.keys()])) {
    classifyOverloadSet(
      baselineByGroup.get(key) ?? [],
      currentByGroup.get(key) ?? [],
      resolve,
      changes,
    )
  }
}

/**
 * @param baseline - All normalized members on the baseline side, keyed by canonical reference.
 * @param current - All normalized members on the current side, keyed by canonical reference.
 * @param options - Callbacks/config the classifier needs, currently just `resolveAssignability`.
 * @returns Every classified change (sorted by `id`) and the single worst-case `ContractImpact` across them.
 */
export function classifyContractChanges(
  baseline: ReadonlyMap<string, NormalizedMember>,
  current: ReadonlyMap<string, NormalizedMember>,
  options: ClassifyOptions,
): ClassifyResult {
  const changes: ApiContractChange[] = []
  const handled = new Set<string>()

  classifyOverloadable(baseline, current, options.resolveAssignability, changes, handled)

  for (const [canonicalReference, currentMember] of current) {
    if (handled.has(canonicalReference)) continue
    const baselineMember = baseline.get(canonicalReference)

    if (!baselineMember) {
      if (currentMember.isTopLevelExport) {
        push(
          changes,
          currentMember,
          "export-added",
          "compatible",
          `Added ${currentMember.scopedName}.`,
        )
      } else if (currentMember.kind === "EnumMember") {
        push(
          changes,
          currentMember,
          "enum-member-added",
          "compatible",
          `Added enum member ${currentMember.scopedName}.`,
        )
      } else if (currentMember.propertyTypeExcerptText !== undefined) {
        // A required property added to a container (interface/class/namespace member, etc.)
        // that itself has no baseline counterpart cannot break an existing consumer -- nobody
        // could have implemented or matched against a shape that did not exist in the baseline
        // contract at all. Only a required property added to an *already-existing* container is
        // a real breaking change (an existing consumer's own conforming object literal/class no
        // longer satisfies the type). Without this check, every new interface/namespace with two
        // or more required members would be misclassified as breaking on its very first release,
        // even though the whole container -- reported separately as its own compatible
        // `export-added` -- is new.
        const parentIsAlsoNew =
          currentMember.parentCanonicalReference !== undefined &&
          !baseline.has(currentMember.parentCanonicalReference)
        push(
          changes,
          currentMember,
          "property-added",
          currentMember.isOptional || parentIsAlsoNew ? "compatible" : "breaking",
          `Added ${currentMember.isOptional ? "optional" : "required"} property ${currentMember.scopedName}${parentIsAlsoNew ? " (on a newly-added container, so not itself breaking)" : ""}.`,
        )
      } else {
        push(
          changes,
          currentMember,
          "export-added",
          "compatible",
          `Added ${currentMember.scopedName}.`,
        )
      }
      continue
    }

    compareMatchedMember(baselineMember, currentMember, options.resolveAssignability, changes)
  }

  for (const [canonicalReference, baselineMember] of baseline) {
    if (handled.has(canonicalReference)) continue
    if (current.has(canonicalReference)) continue

    if (baselineMember.isTopLevelExport) {
      push(
        changes,
        baselineMember,
        "export-removed",
        "breaking",
        `Removed ${baselineMember.scopedName}.`,
      )
    } else if (baselineMember.kind === "EnumMember") {
      push(
        changes,
        baselineMember,
        "enum-member-removed",
        "breaking",
        `Removed enum member ${baselineMember.scopedName}.`,
      )
    } else if (baselineMember.propertyTypeExcerptText !== undefined) {
      push(
        changes,
        baselineMember,
        "property-removed",
        "breaking",
        `Removed property ${baselineMember.scopedName}.`,
      )
    } else {
      push(
        changes,
        baselineMember,
        "export-removed",
        "breaking",
        `Removed ${baselineMember.scopedName}.`,
      )
    }
  }

  changes.sort((a, b) => a.id.localeCompare(b.id))

  let impact: ContractImpact = "unchanged"
  for (const change of changes) {
    const changeImpact: ContractImpact = change.compatibility
    if (IMPACT_RANK[changeImpact] > IMPACT_RANK[impact]) impact = changeImpact
  }

  return { changes, impact }
}
