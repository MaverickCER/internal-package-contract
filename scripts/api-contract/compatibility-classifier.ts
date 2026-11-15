import type { ApiContractChange, ChangeKind, ContractImpact } from "./evidence-types.js"
import type { NormalizedMember, NormalizedParameter, ReleaseTagLevel } from "./model-normalizer.js"

/**
 * Ported from repo-contract's `scripts/api-contract/compatibility-classifier.ts`. The engine now
 * lives only here; repo-contract runs it as a devDependency instead of keeping a copy.
 *
 * A pure diff over two normalized maps, with no API Extractor or TypeScript import. Unit tests can
 * therefore pass a fake `resolveAssignability` and stay fast and synchronous. check.ts wires in the
 * real TypeChecker-backed resolver from type-assignability.ts. Every deterministic rule of the
 * compatibility analysis reads normalized-map facts only. `resolveAssignability` runs only when the
 * rendered excerpt of a type-bearing position changed between baseline and current.
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
    // `kind` is part of the id because one member can emit several distinct changes at once,
    // such as a release-tag change and a property-type change. An id of `canonicalReference`
    // alone collided them.
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
 * @param oldParams - The baseline member's parameters.
 * @param newParams - The current member's parameters.
 * @param resolve - Callback that classifies whether a changed type excerpt is assignability-compatible.
 * @param changes - The accumulator array to append any parameter changes onto.
 */
function compareParameters(
  baselineMember: NormalizedMember,
  currentMember: NormalizedMember,
  oldParams: readonly NormalizedParameter[],
  newParams: readonly NormalizedParameter[],
  resolve: ResolveAssignability,
  changes: ApiContractChange[],
): void {
  const at = (i: number) => `#param-${String(i)}`

  for (const [i, newParam] of newParams.entries()) {
    const oldParam = oldParams[i]
    if (!oldParam) {
      push(
        changes,
        currentMember,
        "parameter-added",
        newParam.isOptional ? "compatible" : "breaking",
        `Added ${newParam.isOptional ? "optional" : "required"} parameter \`${newParam.name}\` to ${currentMember.scopedName}.`,
        at(i),
      )
      continue
    }

    if (oldParam.isOptional !== newParam.isOptional) {
      push(
        changes,
        currentMember,
        "parameter-optionality-changed",
        newParam.isOptional ? "compatible" : "breaking",
        `Parameter \`${newParam.name}\` of ${currentMember.scopedName} became ${newParam.isOptional ? "optional" : "required"}.`,
        at(i),
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
        at(i),
      )
    }
  }

  for (const [offset, oldParam] of oldParams.slice(newParams.length).entries()) {
    push(
      changes,
      currentMember,
      "parameter-removed",
      "breaking",
      `Removed parameter \`${oldParam.name}\` from ${currentMember.scopedName}.`,
      at(newParams.length + offset),
    )
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
    // Stryker disable EqualityOperator: this branch only runs when the two tags differ, and every tag has its own rank, so `<` and `<=` cannot disagree
    const narrowed =
      RELEASE_TAG_RANK[currentMember.releaseTag] < RELEASE_TAG_RANK[baselineMember.releaseTag]
    // Stryker restore EqualityOperator
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
      `${currentMember.scopedName}'s type parameters changed from [${oldTypeParams.join(", ")}] to [${newTypeParams.join(", ")}]; generic parameter changes are not safely classified automatically.`,
    )
  }

  // `extends` and `implements` are compared as two ordered lists, never
  // merged into one. Moving a type between the two clauses keeps the merged
  // set but changes the inheritance:
  // `class C extends A implements B` -> `class C extends B implements A`.
  // `extends` order is kept: a class has at most one, and an interface's
  // reorder means nothing but is still worth surfacing as `unknown`.
  // `implements` is sorted because its order carries no meaning.
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
      `${currentMember.scopedName}'s extends/implements clause changed; inheritance changes are not safely classified automatically.`,
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
    compareParameters(
      baselineMember,
      currentMember,
      baselineMember.parameters,
      currentMember.parameters,
      resolve,
      changes,
    )
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
  return JSON.stringify([member.parentCanonicalReference, member.name, member.kind])
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
    // A signature-matched overload gets the full per-member comparison, not only its return type.
    // Three changes break callers on one overload of a set as they do on a plain function. They are
    // a release-tag narrowing (@public -> @internal), a new @deprecated, and a type-parameter
    // change.
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
  // A wholly new or removed overload set is reported once, for the whole function or method.
  // Otherwise it would read as N bare `overload-added` entries with no `export-added` among them.
  const [removed, ...moreRemoved] = baselineGroup
  const [first, ...moreAdded] = currentGroup
  if (!removed) {
    if (first) push(changes, first, "export-added", "compatible", `Added ${first.scopedName}.`)
    return
  }
  if (!first) {
    push(changes, removed, "export-removed", "breaking", `Removed ${removed.scopedName}.`)
    return
  }
  if (moreRemoved.length === 0 && moreAdded.length === 0) {
    compareMatchedMember(removed, first, resolve, changes)
    return
  }
  compareOverloadSets(baselineGroup, currentGroup, resolve, changes)
}

/**
 * Handles every member with `overloadIndex !== undefined`. The common case is one non-overloaded
 * function or method on each side. It is compared by position, so a parameter or return-type
 * change gets its specific change kind instead of a coarse overload add and remove. Overloads in a
 * multi-overload set are matched within their group by exact parameter-list text, not by
 * `overloadIndex`. A new first overload would otherwise shift every later overload's identity, and
 * each would read as removed and added.
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
 * @param options - Callbacks/config the classifier needs, currently only `resolveAssignability`.
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
        // A required property in a container with no baseline counterpart breaks no consumer.
        // Nobody could implement or match a shape the baseline never had. A required property
        // added to an existing container does break: a consumer's conforming object literal or
        // class no longer satisfies the type. Without this check, every new interface or
        // namespace with two or more required members would read as breaking on its first
        // release. The container itself is reported separately, as a compatible `export-added`.
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
