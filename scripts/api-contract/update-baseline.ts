// The code behind `internal-package-contract update-baseline` (bin/update-baseline.mjs). It is the one normal
// way a target's `.repo-contract/api-contract/<target>/baseline.*` changes once it exists; the `ApiContract`
// check writes only a target's first baseline (check.ts). The surface baseline `SurfaceContract` compares
// against moves in the same run (scripts/surface-contract/run.ts), so both land in one commit.
//
// It reads `typedoc.json` for the targets, `package.json` for the version, each committed baseline, and the
// built declarations API Extractor extracts from. A package with no `typedoc.json` has no API targets; only its
// surface baseline is updated. Files are written to the working tree for a person, or the CI job on the
// Changesets "Version Packages" branch, to review and commit.
//
// Intended order: a public-API change merges with a changeset declaring the right bump (`ApiContract` fails
// otherwise), the Version Packages pull request bumps `package.json`, the release publishes, this command runs,
// the new baseline is committed.
//
// Per-target outcomes, of which only `updated` and `current` exit 0.
//   updated   Regenerates and writes. Either there is no baseline yet for this target (bootstrap), or
//             package.json's version is strictly greater than the committed baseline's. Or the version
//             is unchanged but the public API contents differ (an API-changing commit that merged while
//             the Release PR was open).
//   current   Writes nothing. The baseline already carries package.json's version AND its contents
//             match. This is what every Release-PR `synchronize` after the first sync sees, so it must
//             not fail.
//   refused   Either package.json's version is unparseable, or it is older than the committed baseline's
//             (regenerating would roll the baseline backwards). Or the committed baseline itself records
//             an unparseable version.
//   failed    API Extractor reported errors for this target.
//
// The command's exit code is 1 when any target's outcome is `refused` or `failed`, else 0.

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
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
import { type ApiContractTarget, readTargets } from "./targets.js"
import { runSurfaceUpdate } from "../surface-contract/run.js"

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
 * @returns This target's outcome: see the file header for the full matrix.
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
        message: `Refusing to update: package.json declares version ${packageJson.version}, older than the committed baseline's ${existingBaseline.meta.packageVersion}; regenerating now would roll the baseline backwards. Bump package.json (normally via the Version Packages PR) first.`,
      }
    }
    sameVersion = versionDelta === 0
  }

  const extractResult = runApiExtractorForTarget(root, target)

  if (!extractResult.succeeded) {
    return {
      target: target.name,
      status: "failed",
      message: `API Extractor reported ${String(extractResult.errorCount)} error(s); see stderr above for details.`,
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
      ? `Baseline contents refreshed at version ${packageJson.version}: the public API changed without a version bump. Review .repo-contract/api-contract/${target.name}/baseline.* and commit.`
      : `Baseline updated to version ${packageJson.version}. Review .repo-contract/api-contract/${target.name}/baseline.* and commit.`,
  }
}

/**
 * A package with no `typedoc.json` documents no TypeScript entry point, so it has no API baseline to update,
 * only its CLI, schema and action surface (this repository is one). With a `typedoc.json`, its entry points are
 * the targets, and a `typedoc.json` that cannot be read is the error `readTargets` reports.
 * @param root - Absolute path to the consumer's project root.
 * @returns The API-contract targets to update, possibly none.
 */
async function apiTargets(root: string): Promise<readonly ApiContractTarget[]> {
  return existsSync(path.join(root, "typedoc.json")) ? readTargets(root) : []
}

/**
 * Factored out of the bottom-of-file CLI invocation so a test can exercise the real guardrail
 * logic in-process against a scratch fixture repository.
 * @param root - Absolute path to the consumer's project root whose baselines are being updated.
 * @returns Every target's outcome: see the file header for the full matrix.
 */
export async function runUpdateBaseline(root: string): Promise<readonly TargetUpdateOutcome[]> {
  const [packageJson, targets] = await Promise.all([readPackageJson(root), apiTargets(root)])

  const outcomes: TargetUpdateOutcome[] = []
  for (const target of targets) {
    outcomes.push(await updateOneTarget(root, target, packageJson))
  }
  // The CLI / schema / action baseline moves with the API baselines, in the same commit.
  const surface = await runSurfaceUpdate(root)
  if (surface !== undefined) outcomes.push({ target: "surface", ...surface })
  return outcomes
}

/**
 * The command's body: updates every target and reports each outcome; `updated`/`current` on
 * stdout, `refused`/`failed` on stderr.
 * @param root - Absolute path to the consumer's project root whose baselines are being updated.
 * @param io - Where the per-target lines go.
 * @param io.stdout - Receives the line for each target that was updated or already current.
 * @param io.stderr - Receives the line for each target that was refused or failed.
 * @returns The process exit code: non-zero iff any target was refused or failed.
 */
export async function main(
  root: string,
  io: { readonly stdout: (text: string) => void; readonly stderr: (text: string) => void },
): Promise<number> {
  const outcomes = await runUpdateBaseline(root)
  const lines = outcomes.map((outcome) => ({
    ok: outcome.status === "updated" || outcome.status === "current",
    text: `[${outcome.target}] ${outcome.message}\n`,
  }))
  for (const line of lines) (line.ok ? io.stdout : io.stderr)(line.text)
  return lines.every((line) => line.ok) ? 0 : 1
}

// Stryker disable BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, LogicalOperator, MethodExpression, ObjectLiteral: process entry point, exercised only by spawning the script
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.cwd(), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  })
}
// Stryker restore BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, LogicalOperator, MethodExpression, ObjectLiteral
