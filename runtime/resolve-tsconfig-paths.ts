import path from "node:path"
import { ts } from "./typescript.js"
import type TS from "typescript"
import { assertCompilerApi } from "./compiler-api.js"
import type { BuildFileSystem } from "./build-fs.js"

/**
 * TypeScript path-alias resolution.
 *
 * Resolves a bare import specifier (`"@/lib/env.schema.js"`) against a project's own
 * `tsconfig.json` `compilerOptions.paths`/`baseUrl`, so a schema or consumer reached only
 * through an alias isn't misreported by `link.ts`/`dependency-graph.ts` as unresolved or
 * abandoned. Unlike a package-schema resolver, this never crosses a
 * trust/versioning boundary -- every resolved file is already local, already-trusted
 * project source -- so it is on by default (auto-detecting `root/tsconfig.json`) rather
 * than requiring an explicit allowlist.
 *
 * The actual `paths`/`baseUrl` matching algorithm (longest-prefix matching, `*` wildcard
 * substitution, multiple fallback targets, `extends`-chain merging, JSONC parsing) is
 * delegated entirely to the TypeScript compiler via `ts.resolveModuleName()` and
 * `ts.parseJsonConfigFileContent()` -- the same functions `tsc`/`tsserver` themselves use --
 * rather than reimplemented here. This module's own logic is limited to loading the config,
 * caching resolutions, and enforcing the `node_modules` safety boundary below.
 */

/**
 * The `paths`/`baseUrl` view of parsed compiler options.
 *
 * TypeScript 6 marks `baseUrl` deprecated in its own typings. A project's tsconfig can still set it and
 * TypeScript still honours it, so path resolution has to keep reading it to resolve the way the project's own
 * compiler does. Reading it through this view, which does not carry that deprecation, states that on purpose.
 * @internal
 */
export interface PathMappingOptions {
  readonly paths?: TS.MapLike<string[]>
  readonly baseUrl?: string
}

/**
 * @param options - Parsed compiler options.
 * @returns The same options, typed as the `paths`/`baseUrl` view.
 * @internal
 */
export function pathMappingOptions(options: TS.CompilerOptions): PathMappingOptions {
  return options
}

/** Parsed `tsconfig.json` `paths`/`baseUrl` configuration, immutable for the life of one generate*() run. See {@link loadTsconfigPaths}. */
export interface TsconfigPathsResolution {
  /** The subset of `compilerOptions` `ts.resolveModuleName()` needs -- at minimum `paths` and/or `baseUrl`. */
  readonly compilerOptions: TS.CompilerOptions
  /** Absolute path of the tsconfig.json this was loaded from, for diagnostics. */
  readonly configFile: string
}

/**
 * Opaque memoization for {@link resolveAliasImport}, created once per generate*() run via
 * {@link createAliasResolutionCache} and threaded through `ImportResolutionContext`. Kept
 * distinct from `TsconfigPathsResolution` (immutable config) so the cache's internal
 * representation stays free to change without touching that type's shape.
 */
export interface AliasResolutionCache {
  /**
   * Keyed by `` `${importingFile}\0${specifier}` ``, not by `specifier` alone. With one
   * fixed `compilerOptions` object and no project-reference support, `paths`-pattern
   * substitution itself doesn't depend on the importing file -- but `ts.resolveModuleName()`'s
   * fallback behavior when `paths` doesn't match a real file (classic-mode ancestor search,
   * extension-preference edge cases) legitimately can. A `Map`, not a network call, so
   * keying defensively by both costs nothing.
   */
  readonly resolutions: Map<string, string | undefined>
}

/** Creates a fresh, empty {@link AliasResolutionCache} for one generate*()/computeArtifacts() run. */
export function createAliasResolutionCache(): AliasResolutionCache {
  return { resolutions: new Map() }
}

async function fileExists(filePath: string, fs: BuildFileSystem): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    // Empty on purpose: no BlockStatement mutant on a trailing `{}`, and the fallthrough `return false` below
    // is the answer.
  }
  return false
}

/** A problem with the tsconfig that is reported rather than thrown. Structurally the same as each package's own warning type. */
export interface TsconfigWarning {
  /** Absolute path of the tsconfig the warning applies to. */
  readonly file: string
  /** Human-readable explanation of what was skipped and why. */
  readonly message: string
}

export interface LoadTsconfigPathsResult {
  readonly resolution: TsconfigPathsResolution | undefined
  readonly warning: TsconfigWarning | undefined
}

/**
 * Loads and parses a `tsconfig.json` for alias resolution. Called exactly once per
 * `generate*()`/`computeArtifacts()` invocation, at the same point
 * `resolveAllowlistedPackages()` is already called once -- so at most one tsconfig-related
 * warning is ever produced per run, never once per file scanned.
 *
 * @param product - The consuming package's name, used in the message when no usable compiler resolved.
 * @remarks
 * `tsconfigOption === false` disables alias resolution entirely.
 * `tsconfigOption === undefined` (the default) looks for `root/tsconfig.json` exactly --
 * deliberately not `ts.findConfigFile()`'s upward directory walk, since every other
 * root-relative mechanism in this codebase (schema discovery, `packages` resolution)
 * treats `root` as a hard boundary. A missing default tsconfig is silent (most projects
 * don't use aliases); a missing *explicit* `tsconfigOption` is a real misconfiguration and
 * warns. `jsconfig.json` is intentionally not auto-detected -- pass `tsconfig:
 * "jsconfig.json"` explicitly if needed; this loader only cares about the file's JSON
 * shape, not its name.
 *
 * The gate for building a resolution is "`paths` non-empty OR `baseUrl` set", not `paths`
 * alone -- a `baseUrl`-only tsconfig (no `paths` at all) still makes TypeScript resolve
 * bare specifiers relative to `baseUrl`, and `ts.resolveModuleName()` already handles that
 * once `compilerOptions.baseUrl` is passed through.
 */
export async function loadTsconfigPaths(
  product: string,
  root: string,
  tsconfigOption: string | false | undefined,
  fs: BuildFileSystem,
): Promise<LoadTsconfigPathsResult> {
  if (tsconfigOption === false) return { resolution: undefined, warning: undefined }

  const isExplicit = tsconfigOption !== undefined
  const configFile = path.resolve(root, tsconfigOption ?? "tsconfig.json")

  if (!(await fileExists(configFile, fs))) {
    if (!isExplicit) return { resolution: undefined, warning: undefined }
    return {
      resolution: undefined,
      warning: {
        file: configFile,
        message: `"tsconfig" was set to "${tsconfigOption}", but no file exists at "${configFile}".`,
      },
    }
  }

  // The first use of the compiler on the scan path, so only reached once a config file exists: with
  // none (or a missing explicit path) the compiler is never touched and the early returns above
  // stand. Without this, `ts.readConfigFile()` below would die with a raw "is not a function" when no
  // usable compiler resolved (the bundled TypeScript 6 stripped from an install).
  assertCompilerApi(product, ts)
  const readResult = ts.readConfigFile(configFile, (p) => ts.sys.readFile(p))
  if (readResult.error) {
    const detail = ts.flattenDiagnosticMessageText(readResult.error.messageText, ts.sys.newLine)
    return {
      resolution: undefined,
      warning: {
        file: configFile,
        message: `Could not parse "${configFile}": ${detail}`,
      },
    }
  }

  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, path.dirname(configFile))
  const { paths, baseUrl } = pathMappingOptions(parsed.options)

  const hasPaths = paths !== undefined && Object.keys(paths).length > 0
  if (!hasPaths && baseUrl === undefined) {
    return { resolution: undefined, warning: undefined }
  }

  return { resolution: { compilerOptions: parsed.options, configFile }, warning: undefined }
}

/**
 * Resolves one bare import specifier against a project's `tsconfig.json` `paths`/`baseUrl`,
 * or returns `undefined` if it doesn't resolve through this mechanism.
 *
 * @remarks
 * Necessarily synchronous -- `ts.resolveModuleName()` has no async form, matching how
 * `tsc`/`tsserver` themselves always call it. `ts.sys` is used directly as the resolution
 * host (an existing Node-backed singleton the `typescript` package exports; nothing to
 * construct).
 *
 * Two safety/scope filters apply to any candidate `ts.resolveModuleName()` returns,
 * independent of its own internal fallback behavior:
 *  - **Never resolves into `node_modules`.** `ts.resolveModuleName()` can, in principle,
 *    fall through to classic Node resolution and land inside `node_modules`; any resolved
 *    path containing a `node_modules` path segment (checked after `path.normalize()`, so
 *    mixed separators can't slip past it on Windows) is discarded here. Bare package
 *    specifiers continue to be handled exclusively by `resolvePackageImport()`
 *    -- this mechanism never overlaps with that trust boundary.
 *  - **`.ts`/`.tsx` only.** Matches `resolveRelativeImport()`'s own existing candidate set
 *    and `resolve-package-schema.ts`'s `SCHEMA_FILE_EXTENSIONS` -- this codebase's static-
 *    analysis pipeline is `.ts`/`.tsx` only today. A resolved non-`.ts`/`.tsx` file is a
 *    real risk, not just a gap: feeding it straight into `ts.createSourceFile()` wouldn't
 *    error, it would silently parse garbage -- exactly the "guess" this codebase's
 *    warn-don't-guess philosophy exists to avoid.
 */
export function resolveAliasImport(
  specifier: string,
  importingFile: string,
  resolution: TsconfigPathsResolution,
  cache: AliasResolutionCache,
): string | undefined {
  const cacheKey = `${importingFile}\0${specifier}`
  if (cache.resolutions.has(cacheKey)) return cache.resolutions.get(cacheKey)

  const result = ts.resolveModuleName(specifier, importingFile, resolution.compilerOptions, ts.sys)
  const resolvedFileName = result.resolvedModule?.resolvedFileName

  let resolved: string | undefined
  if (resolvedFileName) {
    const normalized = path.normalize(resolvedFileName)
    const isInNodeModules = normalized.split(path.sep).includes("node_modules")
    const isTsSource = /\.tsx?$/.test(normalized)
    if (!isInNodeModules && isTsSource) resolved = normalized
  }

  cache.resolutions.set(cacheKey, resolved)
  return resolved
}
