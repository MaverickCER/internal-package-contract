/**
 * The `SurfaceContract` check and its baseline update. The baseline is the surface of the last
 * release, committed at `.repo-contract/surface-contract/baseline.json` with the version it was taken
 * at. The check compares the current surface with it, works out the release level the difference
 * needs (the same rules `ApiContract` uses, including the pre-1.0 deflation) and compares that with
 * what the branch's changesets declare.
 */
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { format, resolveConfig } from "prettier"

import { declaredLevelFromChangesets } from "../api-contract/changesets.js"
import type { RequiredReleaseLevel } from "../api-contract/evidence-types.js"
import { rankAtLeast, requiredLevelFor } from "../api-contract/levels.js"
import {
  compareVersions,
  computeMinimumRequiredVersion,
  parseVersion,
} from "../api-contract/semver.js"
import type { Surface, SurfaceChange } from "./classify.js"
import { classifySurface } from "./classify.js"
import type { RunBin } from "./collect.js"
import { collectSurface } from "./collect.js"

export const BASELINE_PATH = path.join(".repo-contract", "surface-contract", "baseline.json")

export interface SurfaceBaseline {
  readonly packageName: string
  readonly packageVersion: string
  readonly surface: Surface
}

export interface SurfaceEvidence {
  readonly currentVersion: string
  /**
   * `no-surface`: nothing to guard. `initial-baseline`: written just now. `missing-baseline`: there is a
   * surface and no baseline, and this run may not create one (CI). `compared`: compared with the baseline.
   */
  readonly status: "no-surface" | "initial-baseline" | "missing-baseline" | "compared"
  readonly changes: readonly SurfaceChange[]
  readonly requiredLevel: RequiredReleaseLevel
  readonly minimumRequiredVersion: string | undefined
  readonly baselineVersion: string | undefined
  readonly changesets: {
    readonly changesetCount: number
    readonly declaredLevel: RequiredReleaseLevel
    readonly satisfied: boolean
  }
}

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, sortKeys(v)]),
        )
      : value

/** @returns `value` as JSON with every object's keys sorted, so the same surface is always the same text. */
export const stableStringify = (value: unknown): string =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`

const isEmpty = (surface: Surface): boolean =>
  Object.keys(surface.cli).length === 0 &&
  Object.keys(surface.schemas).length === 0 &&
  surface.action === null

/**
 * @param root - The package root.
 * @returns The committed baseline, or `undefined` when there is none.
 */
export async function readSurfaceBaseline(root: string): Promise<SurfaceBaseline | undefined> {
  const file = path.join(root, BASELINE_PATH)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(await readFile(file, "utf8")) as SurfaceBaseline
  } catch {
    throw new Error(
      `${BASELINE_PATH} is not valid JSON; restore it from git or regenerate it with \`internal-package-contract update-baseline\`.`,
    )
  }
}

async function writeSurfaceBaseline(root: string, baseline: SurfaceBaseline): Promise<void> {
  const file = path.join(root, BASELINE_PATH)
  await mkdir(path.dirname(file), { recursive: true })
  // Formatted with the repository's own Prettier config, so the `Format` check never has to be told to
  // skip a file this tool generates.
  const options = (await resolveConfig(file)) ?? {}
  await writeFile(file, await format(stableStringify(baseline), { ...options, parser: "json" }))
}

async function readIdentity(root: string): Promise<{ name: string; version: string }> {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    name: string
    version: string
  }
  return { name: pkg.name, version: pkg.version }
}

/**
 * @param root - The package root, built (CLIs must exist).
 * @param options - `ci` forbids creating the first baseline; `runBin` replaces how a CLI is run.
 * @returns The evidence the check's policy judges.
 */
export async function runSurfaceCheck(
  root: string,
  options: { ci?: boolean; runBin?: RunBin } = {},
): Promise<SurfaceEvidence> {
  const [{ name, version }, surface, baseline] = await Promise.all([
    readIdentity(root),
    collectSurface(root, options),
    readSurfaceBaseline(root),
  ])
  const declared = await declaredLevelFromChangesets(root, name)
  const evidence = (
    status: SurfaceEvidence["status"],
    extra: Partial<SurfaceEvidence> = {},
  ): SurfaceEvidence => ({
    currentVersion: version,
    status,
    changes: [],
    requiredLevel: "none",
    minimumRequiredVersion: undefined,
    baselineVersion: undefined,
    changesets: { ...declared, satisfied: true },
    ...extra,
  })

  if (baseline === undefined) {
    if (isEmpty(surface)) return evidence("no-surface")
    if (options.ci === true)
      return evidence("missing-baseline", { changesets: { ...declared, satisfied: false } })
    await writeSurfaceBaseline(root, { packageName: name, packageVersion: version, surface })
    return evidence("initial-baseline")
  }

  const changes = classifySurface(baseline.surface, surface)
  const current = parseVersion(version)
  const preOne = current !== undefined && current.major === 0
  const breaking = changes.some((c) => c.impact === "breaking")
  // `requiredLevelFor` only answers `undefined` for an unclassifiable impact, which this never passes.
  const requiredLevel =
    changes.length === 0
      ? "none"
      : (requiredLevelFor(
          breaking ? "breaking" : "compatible",
          changes.some((c) => c.widens),
          preOne,
        ) as RequiredReleaseLevel)
  const baselineVersion = parseVersion(baseline.packageVersion)
  const minimumRequiredVersion = computeMinimumRequiredVersion(baselineVersion, requiredLevel)
  const minimum = parseVersion(minimumRequiredVersion)
  // A release pull request has consumed its changesets and bumped the version, so the bump itself
  // is the declaration once it reaches the minimum.
  const bumped =
    current !== undefined && minimum !== undefined && compareVersions(current, minimum) >= 0
  return evidence("compared", {
    changes,
    requiredLevel,
    minimumRequiredVersion,
    baselineVersion: baseline.packageVersion,
    changesets: {
      ...declared,
      satisfied: rankAtLeast(declared.declaredLevel, requiredLevel) || bumped,
    },
  })
}

export interface SurfaceUpdateOutcome {
  readonly status: "updated" | "current" | "refused"
  readonly message: string
}

/**
 * Regenerates the baseline after a release. Mirrors the API baseline's rules: it never moves the
 * baseline backwards, and does nothing when it already matches.
 * @param root - The package root, built.
 * @param options - `runBin` replaces how a CLI is run.
 * @returns What happened, or `undefined` when the package has no such surface and no baseline.
 */
export async function runSurfaceUpdate(
  root: string,
  options: { runBin?: RunBin } = {},
): Promise<SurfaceUpdateOutcome | undefined> {
  const [{ name, version }, surface, baseline] = await Promise.all([
    readIdentity(root),
    collectSurface(root, options),
    readSurfaceBaseline(root),
  ])
  if (baseline === undefined && isEmpty(surface)) return undefined
  const current = parseVersion(version)
  if (current === undefined) {
    return {
      status: "refused",
      message: `Refusing to update: could not parse package.json's version "${version}" as major.minor.patch.`,
    }
  }
  let sameVersion = false
  if (baseline !== undefined) {
    const was = parseVersion(baseline.packageVersion)
    if (was === undefined) {
      return {
        status: "refused",
        message: `Refusing to update: the committed surface baseline records an unparseable version "${baseline.packageVersion}".`,
      }
    }
    const delta = compareVersions(current, was)
    if (delta < 0) {
      return {
        status: "refused",
        message: `Refusing to update: package.json declares ${version}, older than the committed surface baseline's ${baseline.packageVersion}.`,
      }
    }
    sameVersion = delta === 0
    if (sameVersion && stableStringify(baseline.surface) === stableStringify(surface)) {
      return {
        status: "current",
        message: `Surface baseline is already at version ${version} with matching contents; nothing to do.`,
      }
    }
  }
  await writeSurfaceBaseline(root, { packageName: name, packageVersion: version, surface })
  return {
    status: "updated",
    message: sameVersion
      ? `Surface baseline contents refreshed at version ${version}. Review ${BASELINE_PATH} and commit.`
      : `Surface baseline updated to version ${version}. Review ${BASELINE_PATH} and commit.`,
  }
}

/**
 * The check script's body: prints the evidence as JSON and nothing else.
 * @param cwd - The package root.
 * @param env - The environment; `CI=true` forbids creating the first baseline.
 * @param write - Where the JSON goes.
 */
export async function main(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  write: (text: string) => void,
): Promise<void> {
  write(JSON.stringify(await runSurfaceCheck(cwd, { ci: env["CI"] === "true" })))
}

// Stryker disable BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression: process entry point, exercised only by spawning the script
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.cwd(), process.env, (text) => process.stdout.write(text))
}
// Stryker restore BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression
