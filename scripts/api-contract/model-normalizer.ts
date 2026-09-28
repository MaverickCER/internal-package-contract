import {
  ApiClass,
  ApiDeclaredItem,
  ApiDocumentedItem,
  ApiExportedMixin,
  ApiInitializerMixin,
  ApiInterface,
  ApiItemContainerMixin,
  ApiItemKind,
  ApiNameMixin,
  ApiOptionalMixin,
  ApiParameterListMixin,
  ApiPropertyItem,
  ApiReadonlyMixin,
  ApiReleaseTagMixin,
  ApiReturnTypeMixin,
  ApiTypeAlias,
  ApiTypeParameterListMixin,
  ApiVariable,
  ReleaseTag,
} from "@microsoft/api-extractor-model"
import type { ApiItem, ApiPackage, Excerpt } from "@microsoft/api-extractor-model"

/**
 * Ported from repo-contract's own `scripts/api-contract/model-normalizer.ts` -- this engine now
 * lives only here (see `checks/api-contract.ts`'s own note); repo-contract consumes it as a
 * devDependency rather than hosting a copy.
 *
 * The single highest-risk file in this feature: it must be built and tested against real,
 * installed `@microsoft/api-extractor-model` `ApiItem` subclasses and mixins, never assumptions
 * about `.api.json`'s raw JSON shape. `.api.json` is the persisted historical format; `ApiModel`/
 * `ApiPackage` is the semantic interpretation layer, and this file goes through the latter
 * exclusively.
 *
 * Walks an `ApiPackage` into a flat, deterministic `ReadonlyMap<string, NormalizedMember>` keyed by
 * `ApiItem.canonicalReference.toString()` -- the only file in the feature where `canonicalReference`
 * (an upstream-`@beta` API) is used as an identity mechanism; `compatibility-classifier.ts`
 * downstream only ever sees the resulting string keys.
 */

export type ReleaseTagLevel = "public" | "beta" | "alpha" | "internal"

export interface NormalizedParameter {
  readonly name: string
  readonly isOptional: boolean
  readonly typeExcerptText: string
}

export interface NormalizedMember {
  readonly canonicalReference: string
  /** Present for items with a declared name (functions, classes, properties, ...); absent for a handful of unnamed kinds (call/construct/index signatures). */
  readonly name?: string | undefined
  readonly scopedName: string
  readonly kind: string
  readonly parentCanonicalReference?: string | undefined
  /** True for an item exported directly from the package's entry point (a top-level export); false for a nested member (a class's property, an enum's member, ...). */
  readonly isTopLevelExport: boolean
  /** Relative to the project folder, e.g. "src/types.ts" -- present only for declared items. Used only for human-readable explanations; never part of identity or the semantic diff. */
  readonly fileUrlPath?: string | undefined
  readonly releaseTag: ReleaseTagLevel
  readonly isDeprecated: boolean
  readonly isExported?: boolean | undefined
  /** Parameters, for function/method/constructor/call-or-construct-signature kinds. */
  readonly parameters?: readonly NormalizedParameter[] | undefined
  readonly returnTypeExcerptText?: string | undefined
  readonly propertyTypeExcerptText?: string | undefined
  readonly isOptional?: boolean | undefined
  readonly isReadonly?: boolean | undefined
  /** One-based overload position, for kinds that support overloads. */
  readonly overloadIndex?: number | undefined
  readonly typeParameterNames?: readonly string[] | undefined
  readonly extendsExcerptTexts?: readonly string[] | undefined
  readonly implementsExcerptTexts?: readonly string[] | undefined
  readonly initializerExcerptText?: string | undefined
  readonly typeAliasExcerptText?: string | undefined
  readonly variableTypeExcerptText?: string | undefined
}

/**
 * @param tag - The upstream `ReleaseTag` enum value read off an `ApiReleaseTagMixin` item.
 * @returns The corresponding lowercase `ReleaseTagLevel`; both `ReleaseTag.Internal` and `ReleaseTag.None` (an item with no release tag at all) map to `"internal"`.
 */
function releaseTagLevel(tag: ReleaseTag): ReleaseTagLevel {
  switch (tag) {
    case ReleaseTag.Public:
      return "public"
    case ReleaseTag.Beta:
      return "beta"
    case ReleaseTag.Alpha:
      return "alpha"
    case ReleaseTag.Internal:
    case ReleaseTag.None:
      return "internal"
  }
}

const THRESHOLD_RANK: Record<ReleaseTagLevel, number> = {
  internal: 0,
  alpha: 1,
  beta: 2,
  public: 3,
}

/**
 * Whether `level` satisfies (is at least as public as) `threshold`.
 * @param level - The release tag level of the item being tested.
 * @param threshold - The minimum release tag level to admit.
 * @returns True if `level` is at least as public as `threshold`.
 */
function meetsThreshold(level: ReleaseTagLevel, threshold: ReleaseTagLevel): boolean {
  return THRESHOLD_RANK[level] >= THRESHOLD_RANK[threshold]
}

/**
 * @param excerpt - The excerpt to render, e.g. a parameter's type excerpt or a property's type excerpt.
 * @returns The excerpt's trimmed source text, or `undefined` if `excerpt` is absent or empty.
 */
function excerptText(excerpt: Excerpt | undefined): string | undefined {
  if (!excerpt || excerpt.isEmpty) return undefined
  return excerpt.text.trim()
}

/**
 * `ApiDeclaredItem.fileUrlPath` is `undefined` in two genuinely different cases upstream doesn't
 * distinguish: the file is unknown, or -- per that getter's own doc comment -- "the path is the
 * same as the parent API item's". The second case is the overwhelmingly common one (any member
 * declared in the same file as its containing class/interface, e.g. a method), so using `item`'s
 * own `fileUrlPath` directly would leave `NormalizedMember.fileUrlPath` empty for most nested
 * members even though the file is perfectly knowable by walking up to the nearest ancestor that
 * does carry it.
 * @param item - The API item to resolve a source file location for.
 * @returns The nearest defined `fileUrlPath` found by walking `item` and its ancestors, or `undefined` if none of them carry one.
 */
function resolveFileUrlPath(item: ApiItem): string | undefined {
  let current: ApiItem | undefined = item
  while (current !== undefined) {
    if (current instanceof ApiDeclaredItem && current.fileUrlPath !== undefined) {
      return current.fileUrlPath
    }
    current = current.parent
  }
  return undefined
}

/**
 * @param item - The API item to inspect for a TSDoc `@deprecated` block.
 * @returns True if `item` carries a TSDoc comment with a `deprecatedBlock`.
 */
function isDeprecated(item: ApiItem): boolean {
  return item instanceof ApiDocumentedItem && item.tsdocComment?.deprecatedBlock !== undefined
}

/**
 * @param item - The API item to normalize.
 * @param threshold - The minimum release tag level to admit; items below it are dropped.
 * @returns The flattened `NormalizedMember` for `item`, or `undefined` if its release tag is below `threshold`.
 */
function buildMember(item: ApiItem, threshold: ReleaseTagLevel): NormalizedMember | undefined {
  const releaseTag = ApiReleaseTagMixin.isBaseClassOf(item)
    ? releaseTagLevel(item.releaseTag)
    : "public"
  if (!meetsThreshold(releaseTag, threshold)) return undefined

  const parent = item.parent
  const member: NormalizedMember = {
    canonicalReference: item.canonicalReference.toString(),
    name: ApiNameMixin.isBaseClassOf(item) ? item.name : undefined,
    scopedName: item.getScopedNameWithinPackage(),
    kind: item.kind,
    parentCanonicalReference: parent?.canonicalReference.toString(),
    isTopLevelExport: parent?.kind === ApiItemKind.EntryPoint,
    fileUrlPath: item instanceof ApiDeclaredItem ? resolveFileUrlPath(item) : undefined,
    releaseTag,
    isDeprecated: isDeprecated(item),
    isExported: ApiExportedMixin.isBaseClassOf(item) ? item.isExported : undefined,
    parameters: ApiParameterListMixin.isBaseClassOf(item)
      ? item.parameters.map((p) => ({
          name: p.name,
          isOptional: p.isOptional,
          typeExcerptText: excerptText(p.parameterTypeExcerpt) ?? "",
        }))
      : undefined,
    returnTypeExcerptText: ApiReturnTypeMixin.isBaseClassOf(item)
      ? excerptText(item.returnTypeExcerpt)
      : undefined,
    propertyTypeExcerptText:
      item instanceof ApiPropertyItem ? excerptText(item.propertyTypeExcerpt) : undefined,
    isOptional: ApiOptionalMixin.isBaseClassOf(item) ? item.isOptional : undefined,
    isReadonly: ApiReadonlyMixin.isBaseClassOf(item) ? item.isReadonly : undefined,
    overloadIndex: ApiParameterListMixin.isBaseClassOf(item) ? item.overloadIndex : undefined,
    typeParameterNames: ApiTypeParameterListMixin.isBaseClassOf(item)
      ? item.typeParameters.map((tp) => tp.name)
      : undefined,
    extendsExcerptTexts:
      item instanceof ApiClass
        ? [excerptText(item.extendsType?.excerpt)].filter((v): v is string => v !== undefined)
        : item instanceof ApiInterface
          ? item.extendsTypes
              .map((h) => excerptText(h.excerpt))
              .filter((v): v is string => v !== undefined)
          : undefined,
    implementsExcerptTexts:
      item instanceof ApiClass
        ? item.implementsTypes
            .map((h) => excerptText(h.excerpt))
            .filter((v): v is string => v !== undefined)
        : undefined,
    initializerExcerptText: ApiInitializerMixin.isBaseClassOf(item)
      ? excerptText(item.initializerExcerpt)
      : undefined,
    typeAliasExcerptText: item instanceof ApiTypeAlias ? excerptText(item.typeExcerpt) : undefined,
    variableTypeExcerptText:
      item instanceof ApiVariable ? excerptText(item.variableTypeExcerpt) : undefined,
  }
  return member
}

/**
 * Kinds with no meaningful contract signature of their own -- pure structural containers that
 * exist to hold other items, not declarations a consumer could depend on directly.
 */
const CONTAINER_ONLY_KINDS = new Set<ApiItemKind>([
  ApiItemKind.Model,
  ApiItemKind.Package,
  ApiItemKind.EntryPoint,
])

/**
 * @param pkg - The API package (from a loaded `.api.json` Doc Model) to walk.
 * @param threshold - The minimum release tag level to admit; items below it (and their descendants' own tag checks) are excluded from the result.
 * @returns A flat, deterministic map of every admitted, non-container member keyed by its `canonicalReference` string.
 */
export function normalizeApiPackage(
  pkg: ApiPackage,
  threshold: ReleaseTagLevel,
): ReadonlyMap<string, NormalizedMember> {
  const result = new Map<string, NormalizedMember>()

  /**
   * @param item - The API item (and, recursively, its container children) to visit.
   */
  function visit(item: ApiItem): void {
    if (
      ApiReleaseTagMixin.isBaseClassOf(item) &&
      !meetsThreshold(releaseTagLevel(item.releaseTag), threshold)
    ) {
      return
    }
    if (ApiExportedMixin.isBaseClassOf(item) && !item.isExported) {
      return
    }

    if (!CONTAINER_ONLY_KINDS.has(item.kind)) {
      const member = buildMember(item, threshold)
      if (member) result.set(member.canonicalReference, member)
    }

    if (ApiItemContainerMixin.isBaseClassOf(item)) {
      for (const child of item.members) visit(child)
    }
  }

  for (const entryPoint of pkg.entryPoints) visit(entryPoint)

  return result
}
