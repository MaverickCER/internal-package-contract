import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * Derives this feature's per-entry-point target list from the consumer's own `typedoc.json`
 * `entryPoints` -- the same field TypeDoc itself uses to document the public surface (see
 * `config/typedoc.json`) -- rather than a second, hand-maintained list. A consumer with several
 * public entry points (e.g. `src/runtime/index.ts`, `src/build/index.ts`) gets one independent
 * api-contract target per entry point, each with its own baseline under
 * `.repo-contract/api-contract/<target>/`.
 */

/**
 * Every public subpath of the package -- the keys of `package.json` `exports` that expose a type
 * declaration (`types` under any condition). A key whose value is a plain path (`./schema` pointing at
 * a JSON file, `./package.json`) exposes no TypeScript API and is not a subpath here.
 * @param exportsField - The parsed `package.json` `exports`.
 * @returns The subpath keys (`"."`, `"./build"`, ...), in declaration order.
 */
export function exportedApiSubpaths(exportsField: unknown): readonly string[] {
  if (typeof exportsField !== "object" || exportsField === null) return []
  const hasTypes = (value: unknown): boolean => {
    if (typeof value !== "object" || value === null) return false
    return Object.entries(value).some(
      ([key, inner]) => (key === "types" && typeof inner === "string") || hasTypes(inner),
    )
  }
  return Object.entries(exportsField)
    .filter(([key, value]) => key.startsWith(".") && !key.includes("*") && hasTypes(value))
    .map(([key]) => key)
}

/**
 * The public subpath a TypeDoc entry point documents: `src/index.ts` is `"."`, `src/build/index.ts`
 * and `src/build.ts` are `"./build"`.
 * @param entryPoint - One `typedoc.json` `entryPoints` entry.
 * @returns The subpath key it is exported as, by the default naming rule.
 */
export function subpathForEntryPoint(entryPoint: string): string {
  const name = targetNameFromEntryPoint(entryPoint)
  return name === "index" ? "." : `./${name}`
}

/**
 * Compares what the package EXPORTS with what the API contract GUARDS. A public subpath no target
 * covers could break in a patch release without the gate noticing; a documented entry point that is
 * not exported guards something users cannot import.
 * @param entryPoints - The `typedoc.json` `entryPoints`.
 * @param subpaths - The package's public subpaths ({@link exportedApiSubpaths}).
 * @param aliases - `package.json` `internal-package-contract.apiTargets`: a subpath whose entry point is not named after it, e.g. `{ ".": "src/runtime/index.ts" }`.
 * @returns The subpaths with no guarding entry point, and the entry points with no subpath.
 */
export function compareExportsToEntryPoints(
  entryPoints: readonly string[],
  subpaths: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): { readonly unguarded: readonly string[]; readonly unexported: readonly string[] } {
  const aliased = new Map(Object.entries(aliases).map(([subpath, entry]) => [entry, subpath]))
  const guarded = new Set(
    entryPoints.map((entry) => aliased.get(entry) ?? subpathForEntryPoint(entry)),
  )
  const exported = new Set(subpaths)
  return {
    unguarded: subpaths.filter((subpath) => !guarded.has(subpath)),
    unexported: entryPoints.filter(
      (entry) => !exported.has(aliased.get(entry) ?? subpathForEntryPoint(entry)),
    ),
  }
}

export interface ApiContractTarget {
  /** Derived from the entry point's path, used to namespace this target's baseline directory and label its evidence. */
  readonly name: string
  /** Relative to the consumer's project root, e.g. "dist/.dts/runtime/index.d.ts". */
  readonly mainEntryPointFilePath: string
}

/**
 * @param entryPoint - One `typedoc.json` `entryPoints` entry, e.g. "src/runtime/index.ts" or "src/index.ts".
 * @returns A short, filesystem-safe target name: "index" for the package root, or the entry point's containing directory name otherwise.
 */
export function targetNameFromEntryPoint(entryPoint: string): string {
  const withoutSrcPrefix = entryPoint.replace(/^\.?\/?src\//, "")
  const withoutIndexSuffix = withoutSrcPrefix.replace(/\/index\.tsx?$/, "").replace(/\.tsx?$/, "")
  return withoutIndexSuffix.length > 0 ? withoutIndexSuffix : "index"
}

/**
 * @param entryPoint - One `typedoc.json` `entryPoints` entry, e.g. "src/runtime/index.ts".
 * @returns The built declaration file this source entry point maps to, per `scripts/emit-dts-shims.mjs`'s own convention: `dist/.dts/<same path>/index.d.ts`.
 */
function mainEntryPointFilePathFor(entryPoint: string): string {
  return entryPoint.replace(/^\.?\/?src\//, "dist/.dts/").replace(/\.tsx?$/, ".d.ts")
}

/**
 * Reads the consumer's own `typedoc.json` (never a `typedoc.markdown.json`/other config that only
 * `extends` it -- `entryPoints` is always declared directly, not inherited) and derives one
 * `ApiContractTarget` per entry point.
 * @param root - Absolute path to the consumer's project root; must contain `typedoc.json`.
 * @returns Every public entry point this consumer documents, as an api-contract target.
 * @throws {Error} If `typedoc.json` is missing, unparseable, or declares no `entryPoints`.
 */
export async function readTargets(root: string): Promise<readonly ApiContractTarget[]> {
  const typedocConfigPath = path.join(root, "typedoc.json")

  let raw: string
  try {
    raw = await readFile(typedocConfigPath, "utf8")
  } catch (error) {
    throw new Error(
      `Could not read ${typedocConfigPath} -- the api-contract check derives its target entry points from typedoc.json's own "entryPoints".`,
      { cause: error },
    )
  }

  let parsed: { entryPoints?: unknown }
  try {
    parsed = JSON.parse(raw) as { entryPoints?: unknown }
  } catch (error) {
    throw new Error(`${typedocConfigPath} is not valid JSON.`, { cause: error })
  }

  const entryPoints = parsed.entryPoints
  if (
    !Array.isArray(entryPoints) ||
    entryPoints.length === 0 ||
    !entryPoints.every((e): e is string => typeof e === "string")
  ) {
    throw new Error(`${typedocConfigPath} must declare a non-empty "entryPoints" array of strings.`)
  }

  await assertEveryExportIsGuarded(root, entryPoints, typedocConfigPath)

  return entryPoints.map((entryPoint) => ({
    name: targetNameFromEntryPoint(entryPoint),
    mainEntryPointFilePath: mainEntryPointFilePathFor(entryPoint),
  }))
}

/**
 * Fails when `package.json` `exports` and `typedoc.json` `entryPoints` disagree: the semver promise
 * covers every public subpath, so a subpath with no target is a hole in it.
 * @param root - The project root.
 * @param entryPoints - The validated `typedoc.json` entry points.
 * @param typedocConfigPath - For the message only.
 */
async function assertEveryExportIsGuarded(
  root: string,
  entryPoints: readonly string[],
  typedocConfigPath: string,
): Promise<void> {
  let pkg: {
    exports?: unknown
    "internal-package-contract"?: { apiTargets?: Record<string, string> }
  }
  try {
    pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as typeof pkg
  } catch {
    return
  }
  const subpaths = exportedApiSubpaths(pkg.exports)
  if (subpaths.length === 0) return
  const { unguarded, unexported } = compareExportsToEntryPoints(
    entryPoints,
    subpaths,
    pkg["internal-package-contract"]?.apiTargets,
  )
  if (unguarded.length === 0 && unexported.length === 0) return
  const problems = [
    ...unguarded.map(
      (subpath) =>
        `- package.json exports ${JSON.stringify(subpath)}, but no ${path.basename(typedocConfigPath)} entry point documents it (add one, e.g. "src/${subpath === "." ? "index" : `${subpath.slice(2)}/index`}.ts"), so its API is not guarded by the api-contract check.`,
    ),
    ...unexported.map(
      (entry) =>
        `- ${path.basename(typedocConfigPath)} documents ${JSON.stringify(entry)}, which no package.json export serves (export it, or map it with package.json "internal-package-contract": { "apiTargets": { "<subpath>": "${entry}" } }).`,
    ),
  ]
  throw new Error(
    `The package's public exports and the API contract's targets disagree:\n${problems.join("\n")}`,
  )
}
