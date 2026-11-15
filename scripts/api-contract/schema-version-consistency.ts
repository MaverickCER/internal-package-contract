import type { ApiContractChange } from "./evidence-types.js"
import type { NormalizedMember } from "./model-normalizer.js"

/**
 * Ported from repo-contract's `scripts/api-contract/schema-version-consistency.ts`. The engine now
 * lives only here; repo-contract runs it as a devDependency instead of keeping a copy.
 *
 * A separate, deliberately narrow pass run in addition to the main compatibility classifier. It
 * looks at every exported interface present in both baseline and current. Of those, it takes each
 * one with a member named `version` whose type is a numeric or string literal. Suppose any *other*
 * member of that interface changed (added/removed/type-changed) but the `version` member's own
 * literal value did *not* change. That is a genuine internal defect: a schema-versioning literal
 * that should have been bumped to reflect the shape change and wasn't. No record or setting exempts
 * this finding (see checks/api-contract.ts). It means a schema-version literal was not updated,
 * never a "not released yet" false positive.
 *
 * The rule is structural: an exported interface with a literal-typed `version` field. It names no
 * interface, so it fits any consumer's versioned schema.
 */

const LITERAL_TYPE_PATTERN = /^(-?\d+|"[^"]*"|'[^']*')$/

/**
 * @param member - The normalized interface member to test.
 * @returns True if `member` is named `version` and its property type excerpt is a numeric or string literal.
 */
function isVersionLiteralMember(member: NormalizedMember): boolean {
  return (
    member.name === "version" &&
    Boolean(member.propertyTypeExcerptText?.match(LITERAL_TYPE_PATTERN))
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
 * @returns `member` without `fileUrlPath`, which records where the declaration lives, not what it declares: a pure file move must not read as a shape change here.
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
        `${currentVersionMember.propertyTypeExcerptText}; bump it to reflect the new schema shape.`,
    })
  }

  return changes.sort((a, b) => a.id.localeCompare(b.id))
}
