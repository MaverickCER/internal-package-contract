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
function targetNameFromEntryPoint(entryPoint: string): string {
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

  return entryPoints.map((entryPoint) => ({
    name: targetNameFromEntryPoint(entryPoint),
    mainEntryPointFilePath: mainEntryPointFilePathFor(entryPoint),
  }))
}
