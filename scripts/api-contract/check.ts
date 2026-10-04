// Entry point for the `ApiContract` check, invoked via `checks/api-contract.ts`'s
// `run: ["tsx", ".../check.ts", "--release-tag=public"]`. Prints ONLY the JSON evidence to stdout
// (for `output: { format: "json" }` to parse) -- everything else, including anything API Extractor
// itself would otherwise print, is routed to stderr.
//
// Adapted from repo-contract's own `scripts/api-contract/check.ts`: loops over every target this
// consumer declares (see targets.ts) instead of one hardcoded entry point, and reads the declared
// bump from `.changeset/*.md` (changesets.ts) instead of Conventional Commit messages -- see
// evidence-types.ts's own module comment for why.

import { readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import type { ApiItem, Excerpt } from "@microsoft/api-extractor-model"
import {
  ApiParameterListMixin,
  ApiPropertyItem,
  ApiReturnTypeMixin,
  ApiTypeAlias,
  ApiVariable,
} from "@microsoft/api-extractor-model"

import {
  readBaseline,
  readPackageJson,
  readSchemaVersion,
  sha256,
  writeBaselineFiles,
} from "./baseline-store.js"
import type { AssignabilityQuery, ResolveAssignability } from "./compatibility-classifier.js"
import { classifyContractChanges } from "./compatibility-classifier.js"
import { declaredLevelFromChangesets } from "./changesets.js"
import { maxLevel, rankAtLeast, requiredLevelFor } from "./levels.js"
import type {
  ApiContractEvidence,
  ApiContractSnapshot,
  ApiContractTargetResult,
  ContractImpact,
  RequiredReleaseLevel,
} from "./evidence-types.js"
import {
  getApiExtractorVersion,
  loadApiModel,
  runApiExtractorForTarget,
} from "./extractor-adapter.js"
import type { ReleaseTagLevel } from "./model-normalizer.js"
import { normalizeApiPackage } from "./model-normalizer.js"
import { detectSchemaVersionDrift } from "./schema-version-consistency.js"
import { computeMinimumRequiredVersion, parseVersion } from "./semver.js"
import { summarizeChanges } from "./summarize-changes.js"
import type { ApiContractTarget } from "./targets.js"
import { readTargets } from "./targets.js"
import {
  buildItemIndex,
  buildReferenceIndex,
  checkAssignability,
  freeTypeParameterNamesFor,
} from "./type-assignability.js"

/**
 * @returns The `--release-tag` CLI argument's value if it's "beta" or "alpha", otherwise "public".
 */
function parseReleaseTagArg(): ReleaseTagLevel {
  const arg = process.argv.find((a) => a.startsWith("--release-tag="))
  const value = arg?.slice("--release-tag=".length)
  return value === "beta" || value === "alpha" ? value : "public"
}

/**
 * @param item - The API item (baseline or current side) to read a type excerpt from.
 * @param position - Which type-bearing position on `item` to read.
 * @param parameterIndex - The parameter's index, required when `position` is "parameter".
 * @returns The excerpt at that position, or `undefined` if `item` doesn't carry one there.
 */
function getExcerptForPosition(
  item: ApiItem,
  position: AssignabilityQuery["position"],
  parameterIndex: number | undefined,
): Excerpt | undefined {
  switch (position) {
    case "parameter":
      return ApiParameterListMixin.isBaseClassOf(item) && parameterIndex !== undefined
        ? item.parameters[parameterIndex]?.parameterTypeExcerpt
        : undefined
    case "return":
      return ApiReturnTypeMixin.isBaseClassOf(item) ? item.returnTypeExcerpt : undefined
    case "property":
      return item instanceof ApiPropertyItem ? item.propertyTypeExcerpt : undefined
    case "variable":
      return item instanceof ApiVariable ? item.variableTypeExcerpt : undefined
    case "type-alias":
      return item instanceof ApiTypeAlias ? item.typeExcerpt : undefined
    default:
      return undefined
  }
}

/**
 * `ApiModel.loadPackage` only accepts a file path -- the committed baseline text (read from git
 * HEAD, never the working tree) is written to a scratch temp file outside the repo, loaded, then
 * removed.
 * @param text - The baseline's raw API JSON text, as read from git `HEAD`.
 * @returns The loaded model's `ApiPackage`.
 */
async function loadPackageFromText(text: string) {
  const tmpPath = path.join(
    os.tmpdir(),
    `ipc-api-contract-baseline-${String(process.pid)}-${String(Date.now())}.api.json`,
  )
  await writeFile(tmpPath, text, "utf8")
  try {
    return loadApiModel(tmpPath).pkg
  } finally {
    await rm(tmpPath, { force: true })
  }
}

/**
 * Runs the full comparison for one target: extracts the current contract, reads (or bootstraps)
 * its committed baseline, and -- unless this is the initial baseline -- classifies every change.
 * @param root - Absolute path to the consumer's project root; must contain a built `dist/` and `tsconfig.json`.
 * @param releaseTag - The minimum release tag (`public`/`beta`/`alpha`) to include in the comparison.
 * @param target - The entry point being compared (see targets.ts).
 * @param packageName - The consumer's own `package.json` `name`, recorded on this target's snapshot.
 * @returns This target's complete result.
 */
async function runSingleTargetCheck(
  root: string,
  releaseTag: ReleaseTagLevel,
  target: ApiContractTarget,
  packageJson: { readonly name: string; readonly version: string },
): Promise<ApiContractTargetResult> {
  const extractResult = runApiExtractorForTarget(root, target)

  if (!extractResult.succeeded) {
    throw new Error(
      `API Extractor reported ${String(extractResult.errorCount)} error(s) for target "${target.name}" -- see stderr above for details.`,
    )
  }

  const [currentApiJsonText, currentDtsText] = await Promise.all([
    readFile(extractResult.apiJsonFilePath, "utf8"),
    readFile(extractResult.dtsRollupFilePath, "utf8"),
  ])
  const { pkg: currentPkg } = loadApiModel(extractResult.apiJsonFilePath)
  const apiExtractorVersion = getApiExtractorVersion()

  const currentSnapshot: ApiContractSnapshot = {
    packageName: packageJson.name,
    apiExtractorVersion,
    apiJsonSchemaVersion: readSchemaVersion(currentApiJsonText),
    apiJsonHash: sha256(currentApiJsonText),
    apiReportPath: path.relative(root, extractResult.apiReportFilePath),
  }

  const baseline = await readBaseline(root, target.name)

  if (!baseline) {
    await writeBaselineFiles(root, target.name, {
      apiJsonText: currentApiJsonText,
      dtsText: currentDtsText,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      apiExtractorVersion,
      apiJsonSchemaVersion: currentSnapshot.apiJsonSchemaVersion,
    })

    return {
      target: target.name,
      initialBaseline: true,
      current: currentSnapshot,
      diff: [],
      lowerTierDiff: [],
      impact: "unchanged",
      requiredLevel: "none",
      minimumRequiredVersion: "0.1.0",
      summary: summarizeChanges([], "unchanged", true),
    }
  }

  const baselinePkg = await loadPackageFromText(baseline.apiJsonText)

  const currentNormalized = normalizeApiPackage(currentPkg, releaseTag)
  const baselineNormalized = normalizeApiPackage(baselinePkg, releaseTag)

  const currentRefIndex = buildReferenceIndex(currentPkg)
  const baselineRefIndex = buildReferenceIndex(baselinePkg)
  const currentItemIndex = buildItemIndex(currentPkg)
  const baselineItemIndex = buildItemIndex(baselinePkg)

  const resolveAssignability: ResolveAssignability = (query) => {
    const oldItem = baselineItemIndex.get(query.oldCanonicalReference)
    const newItem = currentItemIndex.get(query.newCanonicalReference)
    if (!oldItem || !newItem) return "unknown"

    const oldExcerpt = getExcerptForPosition(oldItem, query.position, query.parameterIndex)
    const newExcerpt = getExcerptForPosition(newItem, query.position, query.parameterIndex)
    if (!oldExcerpt || !newExcerpt) return "unknown"

    const freeTypeParameterNames = new Set([
      ...freeTypeParameterNamesFor(oldItem),
      ...freeTypeParameterNamesFor(newItem),
    ])

    return checkAssignability(
      {
        baselineDts: baseline.dtsText,
        currentDts: currentDtsText,
        baselineRefIndex,
        currentRefIndex,
        oldExcerpt,
        newExcerpt,
        freeTypeParameterNames,
      },
      query.direction,
    )
  }

  const { changes: classifierChanges, impact: classifierImpact } = classifyContractChanges(
    baselineNormalized,
    currentNormalized,
    { resolveAssignability },
  )
  const schemaVersionChanges = detectSchemaVersionDrift(baselineNormalized, currentNormalized)
  const diff = [...classifierChanges, ...schemaVersionChanges].sort((a, b) =>
    a.id.localeCompare(b.id),
  )

  // Informational-only pass at the lowest threshold (admits every release tier), so changes below
  // this target's own --release-tag floor aren't silently invisible. Never affects
  // impact/requiredLevel/minimumRequiredVersion below -- those are derived from `diff` alone.
  const { changes: allTierChanges } = classifyContractChanges(
    normalizeApiPackage(baselinePkg, "internal"),
    normalizeApiPackage(currentPkg, "internal"),
    { resolveAssignability },
  )
  const publicIds = new Set(diff.map((change) => change.id))
  const lowerTierDiff = allTierChanges
    .filter((change) => !publicIds.has(change.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  const impact: ContractImpact = schemaVersionChanges.length > 0 ? "breaking" : classifierImpact
  const baselineVersion = parseVersion(baseline.meta.packageVersion)

  // Below 1.0.0 the required level is deflated -- see `requiredLevelFor`.
  const preOne = parseVersion(packageJson.version)?.major === 0

  // A compatible change widens the public surface when it adds an export/member/overload/enum-member
  // (`*-added`), and also on a `release-tag-changed` -- which, being compatible rather than breaking,
  // can only mean a tag was widened (e.g. `@beta` -> `@public`), newly exposing API.
  const widensSurface = diff.some(
    (change) => change.kind.endsWith("-added") || change.kind === "release-tag-changed",
  )
  const requiredLevel = requiredLevelFor(impact, widensSurface, preOne)

  const minimumRequiredVersion =
    requiredLevel === undefined
      ? undefined
      : computeMinimumRequiredVersion(baselineVersion, requiredLevel)

  const summary = summarizeChanges(diff, impact, false)

  return {
    target: target.name,
    initialBaseline: false,
    baseline: {
      packageName: baseline.meta.packageName,
      apiExtractorVersion: baseline.meta.apiExtractorVersion,
      apiJsonSchemaVersion: baseline.meta.apiJsonSchemaVersion,
      apiJsonHash: baseline.meta.apiJsonHash,
    },
    current: currentSnapshot,
    diff,
    lowerTierDiff,
    impact,
    requiredLevel,
    minimumRequiredVersion,
    baselineVersion: baseline.meta.packageVersion,
    summary,
  }
}

/**
 * The check's full logic, factored out of the bottom-of-file script invocation so an integration
 * test can exercise the complete real path (source -> API Extractor -> API JSON -> historical
 * comparison -> evidence) in-process against a scratch fixture repository.
 * @param root - Path to the consumer's project folder; must contain `dist/` (already built), `tsconfig.json`, and `typedoc.json` (targets.ts's source of entry points).
 * @param releaseTag - The minimum release tag (`public`/`beta`/`alpha`) to include in the comparison.
 * @returns The complete evidence for this run -- every target's snapshot/diff/impact/required level, the aggregate required level, and what the branch's changesets declare vs. that requirement.
 */
export async function runApiContractCheck(
  root: string,
  releaseTag: ReleaseTagLevel,
): Promise<ApiContractEvidence> {
  const [packageJson, targets] = await Promise.all([readPackageJson(root), readTargets(root)])

  const preOneRoot = parseVersion(packageJson.version)?.major === 0
  const targetResults: ApiContractTargetResult[] = []
  // Sequential, not `Promise.all`: each target invokes API Extractor's own programmatic API, which
  // is not safe to run concurrently against the same process (it mutates shared compiler-host
  // state) -- the same reason repo-contract's own report-targets.ts looped its (analogous)
  // multi-target extraction sequentially.
  for (const target of targets) {
    targetResults.push(await runSingleTargetCheck(root, releaseTag, target, packageJson))
  }

  // The aggregate required level across every target, folding in "unknown" targets via the same
  // worst-case reasoning a single target's own impact ranking already uses -- see
  // evidence-types.ts's own doc comment on `ApiContractEvidence.requiredLevel`.
  let requiredLevel: RequiredReleaseLevel | undefined = "none"
  let hasUnknownTarget = false
  for (const result of targetResults) {
    if (result.impact === "unknown") {
      hasUnknownTarget = true
      continue
    }
    requiredLevel = maxLevel(requiredLevel, result.requiredLevel ?? "none")
  }
  if (hasUnknownTarget && requiredLevel !== (preOneRoot ? "minor" : "major")) {
    requiredLevel = undefined
  }

  // All targets share one package.json version; pick baselineVersion from any target that has a
  // historical baseline (they should all agree) to compute the one minimumRequiredVersion.
  const baselineVersionText = targetResults.find(
    (result) => !result.initialBaseline,
  )?.baselineVersion
  const minimumRequiredVersion =
    requiredLevel === undefined
      ? undefined
      : computeMinimumRequiredVersion(
          baselineVersionText !== undefined ? parseVersion(baselineVersionText) : undefined,
          requiredLevel,
        )

  const { changesetCount, declaredLevel } = await declaredLevelFromChangesets(
    root,
    packageJson.name,
  )

  const summary = targetResults.map((result) => `[${result.target}] ${result.summary}`).join("\n\n")

  return {
    currentVersion: packageJson.version,
    targets: targetResults,
    requiredLevel,
    minimumRequiredVersion,
    summary,
    changesets: {
      changesetCount,
      declaredLevel,
      satisfied: requiredLevel === undefined ? null : rankAtLeast(declaredLevel, requiredLevel),
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runApiContractCheck(process.cwd(), parseReleaseTagArg())
  process.stdout.write(JSON.stringify(evidence))
}
