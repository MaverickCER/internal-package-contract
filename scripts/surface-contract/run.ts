/**
 * The script behind the `SurfaceContract` check, and the baseline update `update-baseline` calls.
 *
 * It reads `package.json`, the current surface (collect.ts), the committed baseline at
 * `.repo-contract/surface-contract/baseline.json`, the pending `.changeset/*.md`, and `CI`. A package
 * with no CLI, schema or action and no baseline reports `no-surface`, which passes. With no baseline,
 * the first one is written and reported, except under `CI=true`, where the run reports
 * `missing-baseline` and fails; removing the file is not a way past the gate. Otherwise the difference
 * is classified (classify.ts), the required level follows `ApiContract`'s rules including the pre-1.0
 * deflation, and the branch fails unless its changesets declare at least that. A baseline whose version
 * differs from package.json's is stale: the release that set the version did not refresh it, so every
 * difference since would pass unjudged. It fails until `update-baseline` runs, which the `version`
 * script does on the release pull request. A baseline that is not JSON, or records an unparseable
 * version, throws.
 *
 * The update never moves the baseline backwards and writes nothing when it already matches.
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
import { baselinesEditedWithoutRelease } from "../baseline-guard.mjs"

/** Forward slashes on every OS: it appears in messages and in the committed docs. */
export const BASELINE_PATH = ".repo-contract/surface-contract/baseline.json"

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
  /** The baseline records another version than package.json, so the last release did not refresh it. */
  readonly baselineStale: boolean
  /** This branch rewrote the baseline while package.json keeps the base branch's version (baseline-guard.mjs). */
  readonly baselineEdited: boolean
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
  surface.action === null &&
  Object.keys(surface.workflows ?? {}).length === 0

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
    baselineStale: false,
    baselineEdited: false,
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
  // An unreadable baseline version would make every current version look like a sufficient bump.
  if (baselineVersion === undefined) {
    throw new Error(
      `${BASELINE_PATH} records an unparseable version ${JSON.stringify(baseline.packageVersion)}; restore it from git or regenerate it with \`internal-package-contract update-baseline\`.`,
    )
  }
  // A version bump is never a declaration on its own: measured from a baseline the release left
  // behind, any version past the minimum would excuse every later break.
  const baselineStale = current === undefined || compareVersions(current, baselineVersion) !== 0
  const baselineEdited =
    baselinesEditedWithoutRelease({
      cwd: root,
      version,
      baselines: [
        {
          path: BASELINE_PATH,
          versionFile: BASELINE_PATH,
          current: await readFile(path.join(root, BASELINE_PATH), "utf8"),
        },
      ],
    }).edited.length > 0
  return evidence("compared", {
    changes,
    requiredLevel,
    minimumRequiredVersion: computeMinimumRequiredVersion(baselineVersion, requiredLevel),
    baselineVersion: baseline.packageVersion,
    baselineStale,
    baselineEdited,
    changesets: {
      ...declared,
      satisfied: rankAtLeast(declared.declaredLevel, requiredLevel),
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
