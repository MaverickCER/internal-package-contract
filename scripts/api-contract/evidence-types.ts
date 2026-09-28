/**
 * Evidence shape printed to stdout by check.ts (as JSON, for `checks/api-contract.ts`'s
 * `output: { format: "json" }` to parse). Adapted from repo-contract's own
 * `scripts/api-contract/evidence-types.ts` for two differences: this engine is generic across
 * consumers with several public entry points (not one hardcoded target), so evidence is now
 * per-target plus an aggregate; and the declared-bump source is a Changeset file
 * (`.changeset/*.md`), not a Conventional Commit message -- see changesets.ts.
 */

/** Aggregate fact about the public contract delta between baseline and current. "unknown" means the delta could not be safely classified -- never silently downgraded to "compatible" or "unchanged". */
export type ContractImpact = "unchanged" | "compatible" | "breaking" | "unknown"

/**
 * The SemVer release level required by a classified contract delta. Deliberately excludes
 * "unknown" -- a release level is a prescriptive SemVer magnitude, and "we couldn't determine it"
 * is not one. An `impact: "unknown"` result therefore carries no `requiredLevel` at all rather than
 * a synthetic placeholder value.
 */
export type RequiredReleaseLevel = "none" | "patch" | "minor" | "major"

/**
 * The kind of public-contract change a single `ApiContractChange` represents. Kept as explicit
 * union members (not collapsed into a generic "changed") so classifier/formatter/policy code can
 * exhaustively switch on it as the ruleset grows.
 */
export type ChangeKind =
  | "export-added"
  | "export-removed"
  | "release-tag-changed"
  | "parameter-added"
  | "parameter-removed"
  | "parameter-optionality-changed"
  | "parameter-type-changed"
  | "return-type-changed"
  | "property-added"
  | "property-removed"
  | "property-optionality-changed"
  | "property-readonly-changed"
  | "property-type-changed"
  | "generic-parameter-changed"
  | "overload-added"
  | "overload-removed"
  | "overload-changed"
  | "heritage-changed"
  | "enum-member-added"
  | "enum-member-removed"
  | "enum-member-changed"
  | "type-alias-changed"
  | "constructor-changed"
  | "deprecation-changed"
  | "documentation-only"
  | "indeterminate"
  | "schema-version-literal-stale"

/** One classified public-contract change: a stable identity, what kind of change it was, its compatibility, and why. */
export interface ApiContractChange {
  /** Stable, canonical-reference-derived identity for this change -- deterministic across runs for the same contract delta. */
  readonly id: string
  /** Human-readable scoped path, e.g. "MyClass.myMethod" or "getUsers". */
  readonly path: string
  readonly kind: ChangeKind
  readonly compatibility: "compatible" | "breaking" | "unknown"
  readonly explanation: string
}

/** Identity/provenance information for one side (baseline or current) of one target's comparison. */
export interface ApiContractSnapshot {
  readonly packageName: string
  readonly apiExtractorVersion: string
  readonly apiJsonSchemaVersion: number
  /** sha256 of the normalized, deterministic model -- the identity of this snapshot's public contract. */
  readonly apiJsonHash: string
  /** Present only for "current" -- a baseline read from git HEAD has no working-tree file path. */
  readonly apiReportPath?: string | undefined
}

/**
 * One target's (see targets.ts) complete comparison result -- a consumer package may declare
 * several public entry points (e.g. `src/runtime/index.ts`, `src/build/index.ts`), each with its
 * own independent baseline under `.repo-contract/api-contract/<target>/`.
 */
export interface ApiContractTargetResult {
  /** This target's name, derived from its entry point -- see targets.ts. */
  readonly target: string
  readonly initialBaseline: boolean
  /** Absent iff `initialBaseline`. */
  readonly baseline?: ApiContractSnapshot | undefined
  readonly current: ApiContractSnapshot
  /** Always sorted by `id` for determinism. Empty when `initialBaseline` or when nothing changed. */
  readonly diff: readonly ApiContractChange[]
  /**
   * Changes visible only below this check's own `--release-tag` threshold -- included for
   * visibility only. Never affects `impact`/`requiredLevel`/`minimumRequiredVersion`.
   */
  readonly lowerTierDiff: readonly ApiContractChange[]
  readonly impact: ContractImpact
  /** Absent iff `impact === "unknown"`. */
  readonly requiredLevel?: RequiredReleaseLevel | undefined
  /** Absent iff `impact === "unknown"`. `"0.1.0"` when `initialBaseline`. */
  readonly minimumRequiredVersion?: string | undefined
  /** Absent iff `initialBaseline` -- provenance metadata about the historical snapshot, not a property of the TypeScript contract itself. */
  readonly baselineVersion?: string | undefined
  /** Deterministic, generated from `diff`/`impact`/`initialBaseline` -- never hand-authored per scenario. */
  readonly summary: string
}

/**
 * What the branch's Changesets (`.changeset/*.md`) declare about this package's release bump, and
 * whether that clears the minimum the aggregate public-API diff requires. `satisfied` is `null`
 * when there is nothing to compare against: the aggregate `requiredLevel` is absent (some target's
 * impact is `"unknown"` and no other target already requires `"major"`), or every target is on its
 * initial baseline.
 */
export interface ChangesetAnalysisEvidence {
  /** Number of `.changeset/*.md` entries found naming this package. */
  readonly changesetCount: number
  /** The largest bump those entries declare for this package; `"none"` if none name it. */
  readonly declaredLevel: RequiredReleaseLevel
  /** `declaredLevel >= requiredLevel`; `null` when there is no aggregate `requiredLevel` to check against. */
  readonly satisfied: boolean | null
}

/**
 * The complete evidence this check produces for a consumer package with one or more public entry
 * points. `requiredLevel` is absent if and only if `minimumRequiredVersion` is absent -- the check
 * never invents a release level or version for an indeterminate contract delta.
 */
export interface ApiContractEvidence {
  /** Observational only -- the check's own record of package.json's current version. */
  readonly currentVersion: string
  /** One entry per public entry point declared in the consumer's `typedoc.json` -- see targets.ts. */
  readonly targets: readonly ApiContractTargetResult[]
  /**
   * The worst-case bump required across every target. `"unknown"`-impact targets are folded in via
   * the same worst-case reasoning the per-target `impact` already uses: an aggregate is only
   * `undefined` when at least one target is `"unknown"` AND no other target already requires
   * `"major"` (a declared `"major"` bump always satisfies whatever an unknown target might have
   * required, so the ambiguity stops mattering once major is already the floor).
   */
  readonly requiredLevel?: RequiredReleaseLevel | undefined
  /** Absent iff `requiredLevel` is absent. Derived from `requiredLevel` and the package's own current baseline version (all targets share one package.json version). */
  readonly minimumRequiredVersion?: string | undefined
  /** Deterministic, generated by joining every target's own `summary`, prefixed by target name. */
  readonly summary: string
  readonly changesets: ChangesetAnalysisEvidence
}
