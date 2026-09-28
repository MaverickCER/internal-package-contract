// Run via the `internal-package-contract-update-baseline` bin -- the ONLY normal way
// `.repo-contract/api-contract/<target>/baseline.*` is updated once a baseline already exists (the
// check itself only ever bootstraps the very first one per target; see check.ts). Regenerates every
// target's current contract and overwrites its baseline in the working tree for review and commit
// -- by a human, or by a CI job on the Changesets "Version Packages" PR branch.
//
// Intended lifecycle: change public API in a commit whose changeset declares the right bump
// (ApiContract gates this) -> PR merges -> the Version Packages PR bumps package.json/CHANGELOG.md
// and the release publishes -> this command runs -> commit the new baseline.
//
// Adapted from repo-contract's own `scripts/api-contract/update-baseline.ts`: loops every target
// (see targets.ts) instead of operating on one hardcoded entry point.
//
// Per-target outcomes -- only `updated` and `current` exit 0:
//   updated   no baseline yet for this target (bootstrap); or package.json's version is strictly
//             greater than the committed baseline's; or the version is unchanged but the public
//             API contents actually differ (an API-changing commit that merged while the Release
//             PR was open) -> regenerates and writes.
//   current   the baseline already carries package.json's version AND its contents match ->
//             writes nothing. This is what every Release-PR `synchronize` after the first sync
//             sees, so it must not fail.
//   refused   package.json's version is unparseable; or it is older than the committed baseline's
//             (regenerating would roll the baseline backwards); or the committed baseline itself
//             records an unparseable version.
//   failed    API Extractor reported errors for this target.
//
// The command's own overall exit code is non-zero iff any target's outcome is `refused`/`failed`.

import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import {
  readBaseline,
  readPackageJson,
  readSchemaVersion,
  sha256,
  writeBaselineFiles,
} from "./baseline-store.js"
import { getApiExtractorVersion, runApiExtractorForTarget } from "./extractor-adapter.js"
import { compareVersions, parseVersion } from "./semver.js"
import { readTargets } from "./targets.js"

export interface TargetUpdateOutcome {
  readonly target: string
  readonly status: "updated" | "current" | "refused" | "failed"
  readonly message: string
}

/**
 * Runs the guardrail/regenerate logic for one target.
 * @param root - Absolute path to the consumer's project root.
 * @param target - The target to update (see targets.ts).
 * @param packageJson - The consumer's own `package.json` `name`/`version`.
 * @returns This target's outcome -- see the file header for the full matrix.
 */
async function updateOneTarget(
  root: string,
  target: { readonly name: string; readonly mainEntryPointFilePath: string },
  packageJson: { readonly name: string; readonly version: string },
): Promise<TargetUpdateOutcome> {
  const currentVersion = parseVersion(packageJson.version)
  if (!currentVersion) {
    return {
      target: target.name,
      status: "refused",
      message: `Refusing to update: could not parse package.json's version "${packageJson.version}" as major.minor.patch. Fix package.json before running this again.`,
    }
  }

  const existingBaseline = await readBaseline(root, target.name)

  let sameVersion = false
  if (existingBaseline) {
    const baselineVersion = parseVersion(existingBaseline.meta.packageVersion)
    if (!baselineVersion) {
      return {
        target: target.name,
        status: "refused",
        message: `Refusing to update: the committed baseline records an unparseable version "${existingBaseline.meta.packageVersion}". Regenerate it from a known-good commit.`,
      }
    }

    const versionDelta = compareVersions(currentVersion, baselineVersion)
    if (versionDelta < 0) {
      return {
        target: target.name,
        status: "refused",
        message: `Refusing to update: package.json declares version ${packageJson.version}, older than the committed baseline's ${existingBaseline.meta.packageVersion} -- regenerating now would roll the baseline backwards. Bump package.json (normally via the Version Packages PR) first.`,
      }
    }
    sameVersion = versionDelta === 0
  }

  const extractResult = runApiExtractorForTarget(root, target)

  if (!extractResult.succeeded) {
    return {
      target: target.name,
      status: "failed",
      message: `API Extractor reported ${String(extractResult.errorCount)} error(s) -- see stderr above for details.`,
    }
  }

  const [apiJsonText, dtsText] = await Promise.all([
    readFile(extractResult.apiJsonFilePath, "utf8"),
    readFile(extractResult.dtsRollupFilePath, "utf8"),
  ])

  if (
    sameVersion &&
    sha256(apiJsonText) === existingBaseline?.meta.apiJsonHash &&
    sha256(dtsText) === existingBaseline.meta.dtsHash
  ) {
    return {
      target: target.name,
      status: "current",
      message: `Baseline is already at version ${packageJson.version} with matching contents; nothing to do.`,
    }
  }

  const apiJsonSchemaVersion = readSchemaVersion(apiJsonText)

  await writeBaselineFiles(root, target.name, {
    apiJsonText,
    dtsText,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    apiExtractorVersion: getApiExtractorVersion(),
    apiJsonSchemaVersion,
  })

  return {
    target: target.name,
    status: "updated",
    message: sameVersion
      ? `Baseline contents refreshed at version ${packageJson.version} -- the public API changed without a version bump. Review .repo-contract/api-contract/${target.name}/baseline.* and commit.`
      : `Baseline updated to version ${packageJson.version}. Review .repo-contract/api-contract/${target.name}/baseline.* and commit.`,
  }
}

/**
 * Factored out of the bottom-of-file CLI invocation so a test can exercise the real guardrail
 * logic in-process against a scratch fixture repository.
 * @param root - Absolute path to the consumer's project root whose baselines are being updated.
 * @returns Every target's outcome -- see the file header for the full matrix.
 */
export async function runUpdateBaseline(root: string): Promise<readonly TargetUpdateOutcome[]> {
  const [packageJson, targets] = await Promise.all([readPackageJson(root), readTargets(root)])

  const outcomes: TargetUpdateOutcome[] = []
  for (const target of targets) {
    outcomes.push(await updateOneTarget(root, target, packageJson))
  }
  return outcomes
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcomes = await runUpdateBaseline(process.cwd())
  let failed = false
  for (const outcome of outcomes) {
    const line = `[${outcome.target}] ${outcome.message}`
    if (outcome.status === "updated" || outcome.status === "current") {
      process.stdout.write(`${line}\n`)
    } else {
      failed = true
      process.stderr.write(`${line}\n`)
    }
  }
  if (failed) process.exitCode = 1
}
