import type { ApiContractChange } from "./evidence-types.js"
import type { NormalizedMember } from "./model-normalizer.js"

/**
 * Ported from repo-contract's own `scripts/api-contract/schema-version-consistency.ts` -- this
 * engine now lives only here (see `checks/api-contract.ts`'s own note); repo-contract consumes it
 * as a devDependency rather than hosting a copy.
 *
 * A separate, deliberately narrow pass run in addition to the main compatibility classifier. For
 * every exported interface present in both baseline and current that has a member literally named
 * `version` with a numeric or string literal type: if any *other* member of that interface changed
 * (added/removed/type-changed) but the `version` member's own literal value did *not* change, this
 * is a genuine internal defect -- a schema-versioning literal that should have been bumped to
 * reflect the shape change and wasn't. This is the one category of finding that can make the policy
 * fail even though it's otherwise advisory (see checks/api-contract.ts) -- it represents forgetting
 * to update a schema-version literal, not a "not released yet" false positive.
 *
 * Purely structural (an exported interface + a literal-typed `version` field), not a hardcoded
 * name check against specific interfaces, so it generalizes to any consumer's own versioned schema.
 */

const LITERAL_TYPE_PATTERN = /^(-?\d+|"[^"]*"|'[^']*')$/

/**
 * @param member - The normalized interface member to test.
 * @returns True if `member` is named `version` and its property type excerpt is a numeric or string literal.
 */
function isVersionLiteralMember(member: NormalizedMember): boolean {
  return (
    member.name === "version" &&
    member.propertyTypeExcerptText !== undefined &&
    LITERAL_TYPE_PATTERN.test(member.propertyTypeExcerptText)
  )
}

/**
 * @param map - The normalized member map (baseline or current) to search.
 * @param parentCanonicalReference - The canonical reference of the containing interface.
 * @returns Every member directly nested under `parentCanonicalReference`.
 */
function childrenOf(
  map: ReadonlyMap<string, NormalizedMember>,
  parentCanonicalReference: string,
): readonly NormalizedMember[] {
  return [...map.values()].filter((m) => m.parentCanonicalReference === parentCanonicalReference)
}

/**
 * @param member - The normalized member to reduce to its semantic identity.
 * @returns `member` without `fileUrlPath`, which records where the declaration lives, not what it declares -- a pure file move must not read as a shape change here.
 */
function semanticIdentity(member: NormalizedMember): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...member }
  delete rest["fileUrlPath"]
  return rest
}

/**
 * @param a - A normalized member from one snapshot.
 * @param b - The corresponding normalized member from the other snapshot.
 * @returns True if `a` and `b` are structurally identical apart from `fileUrlPath` (see {@link semanticIdentity}).
 */
function membersEqual(a: NormalizedMember, b: NormalizedMember): boolean {
  return JSON.stringify(semanticIdentity(a)) === JSON.stringify(semanticIdentity(b))
}

/**
 * @param baseline - The normalized baseline member map.
 * @param current - The normalized current member map.
 * @returns One `breaking` `ApiContractChange` per exported interface whose `version` literal member stayed the same value while some other member of that interface was added, removed, or changed; sorted by `id`.
 */
export function detectSchemaVersionDrift(
  baseline: ReadonlyMap<string, NormalizedMember>,
  current: ReadonlyMap<string, NormalizedMember>,
): readonly ApiContractChange[] {
  const changes: ApiContractChange[] = []

  for (const [canonicalReference, currentInterface] of current) {
    if (currentInterface.kind !== "Interface") continue
    const baselineInterface = baseline.get(canonicalReference)
    if (baselineInterface?.kind !== "Interface") continue

    const currentChildren = childrenOf(current, canonicalReference)
    const baselineChildren = childrenOf(baseline, canonicalReference)

    const currentVersionMember = currentChildren.find(isVersionLiteralMember)
    const baselineVersionMember = baselineChildren.find(isVersionLiteralMember)
    if (!currentVersionMember || !baselineVersionMember) continue

    const versionLiteralUnchanged =
      currentVersionMember.propertyTypeExcerptText === baselineVersionMember.propertyTypeExcerptText

    if (!versionLiteralUnchanged) continue

    const otherCurrent = currentChildren.filter(
      (m) => m.canonicalReference !== currentVersionMember.canonicalReference,
    )
    const otherBaseline = baselineChildren.filter(
      (m) => m.canonicalReference !== baselineVersionMember.canonicalReference,
    )

    const currentByRef = new Map(otherCurrent.map((m) => [m.canonicalReference, m]))
    const baselineByRef = new Map(otherBaseline.map((m) => [m.canonicalReference, m]))

    const added = [...currentByRef.keys()].filter((ref) => !baselineByRef.has(ref))
    const removed = [...baselineByRef.keys()].filter((ref) => !currentByRef.has(ref))
    const changed = [...currentByRef.entries()].filter(([ref, member]) => {
      const previous = baselineByRef.get(ref)
      return previous !== undefined && !membersEqual(previous, member)
    })

    if (added.length === 0 && removed.length === 0 && changed.length === 0) continue

    const location = currentInterface.fileUrlPath ? ` in ${currentInterface.fileUrlPath}` : ""
    changes.push({
      id: `${canonicalReference}#schema-version-literal`,
      path: currentInterface.scopedName,
      kind: "schema-version-literal-stale",
      compatibility: "breaking",
      explanation:
        `${currentInterface.scopedName}${location} changed shape (${String(
          added.length + removed.length + changed.length,
        )} member(s) added/removed/changed) but its \`version\` literal is still ` +
        `${currentVersionMember.propertyTypeExcerptText} -- bump it to reflect the new schema shape.`,
    })
  }

  return changes.sort((a, b) => a.id.localeCompare(b.id))
}
