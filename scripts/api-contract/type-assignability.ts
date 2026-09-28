import {
  ApiItemContainerMixin,
  ApiNameMixin,
  ApiTypeParameterListMixin,
  ExcerptTokenKind,
} from "@microsoft/api-extractor-model"
import type { ApiItem, ApiPackage, Excerpt } from "@microsoft/api-extractor-model"
import * as ts from "typescript"
import path from "node:path"

/**
 * Ported from repo-contract's own `scripts/api-contract/type-assignability.ts` -- this engine now
 * lives only here (see `checks/api-contract.ts`'s own note); repo-contract consumes it as a
 * devDependency rather than hosting a copy.
 *
 * The TypeChecker probe engine. Builds an in-memory `ts.Program` (a custom `ts.CompilerHost`
 * layered over the default one only for lib-file resolution, no disk I/O for the baseline/current
 * declaration text itself) with two virtual declaration files -- baseline's integrity-checked
 * `.d.ts` rollup, current's freshly generated one -- and a synthetic probe file containing exactly
 * one assignment statement in the position-appropriate direction, then inspects the real compiler's
 * `getSemanticDiagnostics()` for a "not assignable" error. This is deliberately real TypeChecker
 * assignability, not a hand-rolled structural approximator or a type-string comparison.
 *
 * Because this reconstructs type text from excerpt tokens and re-checks it with a real compiler
 * rather than hand-parsing TypeScript syntax, it already correctly handles unions, intersections,
 * conditional types, mapped types, indexed-access types, function types, `keyof`, `typeof`, and
 * `infer` -- these are just `Content`-token syntax around zero or more `Reference` tokens, and the
 * real compiler understands all of them natively once reconstructed; no per-construct
 * special-casing is needed here. The genuinely hard part is never "can TypeScript check this," it's
 * faithfully reconstructing the exact contextual type expression from API Extractor's excerpt
 * tokens and resolving every one of its references -- when that can't be established, this module
 * returns `"unknown"` rather than guessing.
 */

export type AssignabilityDirection = "contravariant" | "covariant" | "invariant"
type AssignabilityResult = "compatible" | "breaking" | "unknown"

export interface AssignabilityContext {
  readonly baselineDts: string
  readonly currentDts: string
  readonly baselineRefIndex: ReadonlyMap<string, string>
  readonly currentRefIndex: ReadonlyMap<string, string>
  readonly oldExcerpt: Excerpt
  readonly newExcerpt: Excerpt
  /** Type-parameter names in scope at this position (own + every ancestor container's) -- any excerpt referencing one of these is conservatively forced to "unknown" rather than unsoundly instantiated. */
  readonly freeTypeParameterNames: ReadonlySet<string>
}

/**
 * Maps every `ApiItem`'s canonical reference to the name it's exported under at the top level of
 * the package's rolled-up declarations -- built by walking the whole `ApiPackage` tree (not
 * filtered by release tag; a probe still needs to resolve a reference even if the containing
 * schema-version-consistency/classifier pass would otherwise trim it). Not
 * `ApiModel.resolveDeclarationReference()`, which resolves a parsed TSDoc link tag against a
 * contextual item -- the wrong input shape for "I already have an `ExcerptToken.canonicalReference`,
 * resolve it to a locally-importable name."
 * @param pkg - The API package (baseline's or current's) to walk.
 * @returns A map from every item's canonical reference string to the name it's imported under at the top level of that package's rolled-up declarations.
 */
export function buildReferenceIndex(pkg: ApiPackage): Map<string, string> {
  const index = new Map<string, string>()

  /**
   * @param item - The API item (and, recursively, its container children) to visit.
   * @param topLevelName - The top-level export name inherited from an ancestor, or `undefined` if `item` is itself a top-level export.
   */
  function visit(item: ApiItem, topLevelName: string | undefined): void {
    const nextTopLevelName =
      topLevelName ?? (ApiNameMixin.isBaseClassOf(item) ? item.name : undefined)
    if (nextTopLevelName !== undefined) {
      index.set(item.canonicalReference.toString(), nextTopLevelName)
    }
    if (ApiItemContainerMixin.isBaseClassOf(item)) {
      for (const child of item.members) visit(child, nextTopLevelName)
    }
  }

  for (const entryPoint of pkg.entryPoints) {
    for (const member of entryPoint.members) visit(member, undefined)
  }

  return index
}

/**
 * Maps every `ApiItem`'s canonical reference to the item itself -- used by check.ts's real
 * `resolveAssignability` bridge to look up the concrete `Excerpt`/type-parameter context a
 * `compatibility-classifier.ts` query refers to by canonical reference alone.
 * @param pkg - The API package (baseline's or current's) to walk.
 * @returns A map from every item's canonical reference string to the item itself.
 */
export function buildItemIndex(pkg: ApiPackage): Map<string, ApiItem> {
  const index = new Map<string, ApiItem>()

  /**
   * @param item - The API item (and, recursively, its container children) to visit.
   */
  function visit(item: ApiItem): void {
    index.set(item.canonicalReference.toString(), item)
    if (ApiItemContainerMixin.isBaseClassOf(item)) {
      for (const child of item.members) visit(child)
    }
  }

  for (const entryPoint of pkg.entryPoints) visit(entryPoint)
  return index
}

/**
 * Every type-parameter name visible at `item`'s position -- its own plus every ancestor container's.
 * @param item - The API item whose enclosing type-parameter scope is being computed.
 * @returns The set of type-parameter names in scope at `item`'s position.
 */
export function freeTypeParameterNamesFor(item: ApiItem): ReadonlySet<string> {
  const names = new Set<string>()
  let current: ApiItem | undefined = item
  while (current) {
    if (ApiTypeParameterListMixin.isBaseClassOf(current)) {
      for (const tp of current.typeParameters) names.add(tp.name)
    }
    current = current.parent
  }
  return names
}

type Snapshot = "baseline" | "current"

interface ImportSpec {
  readonly localName: string
  readonly importedName: string
  readonly snapshot: Snapshot
}

interface Reconstruction {
  readonly text: string
  readonly imports: readonly ImportSpec[]
}

/**
 * @param char - One character (or `undefined`, past either end of the string) to classify.
 * @returns Whether `char` is a "word" character (`[A-Za-z0-9_]`) -- the same class regex `\b` boundaries are defined against.
 */
function isWordChar(char: string | undefined): boolean {
  if (char === undefined) return false
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "_"
  )
}

/**
 * Whole-word substring search -- equivalent to testing `new RegExp(\`\\b${word}\\b\`)`, but as plain
 * string scanning rather than a dynamically constructed `RegExp`, which
 * `security/detect-non-literal-regexp` flags regardless of how thoroughly `word` is escaped first.
 * @param haystack - The text to search.
 * @param word - The exact word to search for, matched only where it isn't adjacent to another word character.
 * @returns Whether `word` occurs in `haystack` as a whole word.
 */
function containsWholeWord(haystack: string, word: string): boolean {
  if (word.length === 0) return false

  let index = haystack.indexOf(word)
  while (index !== -1) {
    const before = index > 0 ? haystack[index - 1] : undefined
    const after = index + word.length < haystack.length ? haystack[index + word.length] : undefined
    if (!isWordChar(before) && !isWordChar(after)) return true

    index = haystack.indexOf(word, index + 1)
  }

  return false
}

/**
 * Walks an excerpt's spanned tokens, copying `Content` tokens verbatim and substituting `Reference`
 * tokens with a synthesized locally-aliased import. Returns `undefined` -- the module's uniform
 * "can't safely probe" signal -- when a content token whole-word-matches a free type-parameter
 * name, or a reference token can't be resolved to an importable name (external package, or trimmed
 * by the release-tag threshold).
 * @param excerpt - The excerpt (a parameter type, return type, etc.) to reconstruct as standalone source text.
 * @param refIndex - The reference index (baseline's or current's, matching `snapshot`) used to resolve `Reference` tokens to importable names.
 * @param snapshot - Which side of the comparison `excerpt` came from; recorded on each generated import so the probe imports from the right virtual `.d.ts` file.
 * @param aliasPrefix - Prefix used to synthesize unique local import names, avoiding collisions between the two sides of the probe.
 * @param freeTypeParameterNames - Type-parameter names in scope at this position; any `Content` token that whole-word-matches one aborts the reconstruction.
 * @returns The reconstructed type expression text plus the imports it requires, or `undefined` if it can't be safely reconstructed.
 */
function reconstructTypeExpression(
  excerpt: Excerpt,
  refIndex: ReadonlyMap<string, string>,
  snapshot: Snapshot,
  aliasPrefix: string,
  freeTypeParameterNames: ReadonlySet<string>,
): Reconstruction | undefined {
  const imports: ImportSpec[] = []
  const localNameByRef = new Map<string, string>()
  let text = ""

  for (const token of excerpt.spannedTokens) {
    if (token.kind === ExcerptTokenKind.Content) {
      for (const typeParameterName of freeTypeParameterNames) {
        if (containsWholeWord(token.text, typeParameterName)) return undefined
      }
      text += token.text
      continue
    }

    const canonicalReference = token.canonicalReference?.toString()
    if (canonicalReference === undefined) return undefined
    const importedName = refIndex.get(canonicalReference)
    if (importedName === undefined) return undefined

    let localName = localNameByRef.get(canonicalReference)
    if (localName === undefined) {
      localName = `${aliasPrefix}_${String(imports.length)}`
      localNameByRef.set(canonicalReference, localName)
      imports.push({ localName, importedName, snapshot })
    }
    text += localName
  }

  return { text, imports }
}

/**
 * @param fileName - A file path as passed by the TypeScript compiler host, possibly using backslash separators.
 * @returns `fileName` normalized to forward-slash, POSIX-style form, matching the virtual file map's keys.
 */
function normalizeVirtualPath(fileName: string): string {
  return path.posix.normalize(fileName.replace(/\\/g, "/"))
}

/**
 * @param files - The in-memory virtual file map (path to source text) for the baseline `.d.ts`, current `.d.ts`, and synthetic probe file. A live reference -- later mutations (e.g. swapping in a new probe file's text) are visible to the returned host without rebuilding it.
 * @param compilerOptions - The compiler options the resulting host's default (disk-backed) behavior falls back to for everything not in `files`, e.g. lib files.
 * @returns A `ts.CompilerHost` that resolves paths present in `files` from memory and delegates everything else to a standard disk-backed host. Reuses a previously parsed `ts.SourceFile` whenever a path is requested again with unchanged content -- letting `ts.createProgram`'s own `oldProgram` reuse skip re-parsing/re-binding the baseline/current `.d.ts` rollups on every probe, since only the synthetic probe file's content actually changes between probes.
 */
function createVirtualCompilerHost(
  files: ReadonlyMap<string, string>,
  compilerOptions: ts.CompilerOptions,
): ts.CompilerHost {
  const base = ts.createCompilerHost(compilerOptions, true)
  const sourceFileCache = new Map<
    string,
    { readonly content: string; readonly file: ts.SourceFile }
  >()

  return {
    ...base,
    fileExists: (fileName) =>
      files.has(normalizeVirtualPath(fileName)) || base.fileExists(fileName),
    readFile: (fileName) => files.get(normalizeVirtualPath(fileName)) ?? base.readFile(fileName),
    getSourceFile: (fileName, languageVersionOrOptions, onError) => {
      const path = normalizeVirtualPath(fileName)
      const content = files.get(path)
      if (content === undefined)
        return base.getSourceFile(fileName, languageVersionOrOptions, onError)

      const cached = sourceFileCache.get(path)
      if (cached?.content === content) return cached.file

      const file = ts.createSourceFile(fileName, content, languageVersionOrOptions, true)
      sourceFileCache.set(path, { content, file })
      return file
    },
  }
}

/**
 * `probeAssignability` invokes the real TypeScript compiler once per assignability direction
 * checked (up to twice per `checkAssignability` call, itself called once per compared API item),
 * and every invocation shares the identical `compilerOptions` plus, within one `runApiContractCheck`
 * run, the identical `baselineDts`/`currentDts` text -- only the synthetic probe file's content
 * differs between calls. Rebuilding a `ts.CompilerHost` (which resolves and reads every lib file
 * from disk) and reparsing/rebinding both multi-file `.d.ts` rollups from scratch on every single
 * probe is the dominant cost of this module's hot path. This module-level cache -- keyed on the
 * `baselineDts`/`currentDts` pair actually passed in -- lets every probe within a run reuse the same
 * host (and, via `oldProgram`, the same already-bound baseline/current source files), rebuilding
 * only when a different `baselineDts`/`currentDts` pair is seen (a different run, or a test calling
 * this module against different fixtures in the same process).
 */
interface ProbeHostCache {
  readonly baselineDts: string
  readonly currentDts: string
  readonly files: Map<string, string>
  readonly host: ts.CompilerHost
  program: ts.Program | undefined
}

// A `const`-bound mutable ref, not a top-level `let` -- `.current` is still genuinely reassigned on
// a cache miss, same mutable module-scoped state either way. Kept module-scoped rather than
// threaded as an explicit parameter through checkAssignability/probeAssignability because both are
// already-public, already-tested entry points that would all need a new required argument for a
// purely internal perf optimization with no behavioral difference to any caller.
const probeHostCacheRef: { current: ProbeHostCache | undefined } = { current: undefined }

const PROBE_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
}

/**
 * @param baselineDts - The baseline package's `.d.ts` rollup text for this probe.
 * @param currentDts - The current package's `.d.ts` rollup text for this probe.
 * @returns The cached (or freshly built, on a cache miss) host/file-map/program-so-far for this exact `baselineDts`/`currentDts` pair.
 */
function getProbeHost(baselineDts: string, currentDts: string): ProbeHostCache {
  const cached = probeHostCacheRef.current
  if (cached?.baselineDts === baselineDts && cached.currentDts === currentDts) {
    return cached
  }

  const files = new Map<string, string>([
    ["/__baseline__.d.ts", baselineDts],
    ["/__current__.d.ts", currentDts],
  ])
  const host = createVirtualCompilerHost(files, PROBE_COMPILER_OPTIONS)
  const fresh: ProbeHostCache = { baselineDts, currentDts, files, host, program: undefined }
  probeHostCacheRef.current = fresh
  return fresh
}

/**
 * @param input - The two `.d.ts` rollups to compile against, the synthesized imports the reconstructed types need, and the `from`/`to` type expressions to check assignability between.
 * @param input.baselineDts - The baseline package's self-contained `.d.ts` rollup text, mounted as a virtual file.
 * @param input.currentDts - The current package's self-contained `.d.ts` rollup text, mounted as a virtual file.
 * @param input.imports - The synthesized aliased imports the reconstructed `fromText`/`toText` expressions reference.
 * @param input.fromText - The source-side type expression text for the probe assignment.
 * @param input.toText - The target-side type expression text for the probe assignment.
 * @returns `"compatible"` if the real TypeScript compiler accepts assigning `fromText` to `toText`, `"breaking"` if it reports a "not assignable" diagnostic on the assignment line, or `"unknown"` if the probe itself couldn't be trusted (a syntax error, or a diagnostic anywhere else).
 */
function probeAssignability(input: {
  readonly baselineDts: string
  readonly currentDts: string
  readonly imports: readonly ImportSpec[]
  readonly fromText: string
  readonly toText: string
}): AssignabilityResult {
  const importLines = input.imports.map(
    (i) => `import type { ${i.importedName} as ${i.localName} } from "./__${i.snapshot}__";`,
  )

  const preambleLines = [
    ...importLines,
    `type __From = ${input.fromText};`,
    `type __To = ${input.toText};`,
    "declare const __v__: __From;",
  ]
  const assignmentLine = "const __c__: __To = __v__;"
  const probeSource = [...preambleLines, assignmentLine].join("\n")

  const probeCache = getProbeHost(input.baselineDts, input.currentDts)
  probeCache.files.set("/__probe__.ts", probeSource)

  const program = ts.createProgram(
    ["/__probe__.ts"],
    PROBE_COMPILER_OPTIONS,
    probeCache.host,
    probeCache.program,
  )
  probeCache.program = program
  const probeFile = program.getSourceFile("/__probe__.ts")
  if (!probeFile) return "unknown"

  if (program.getSyntacticDiagnostics(probeFile).length > 0) return "unknown"

  // TypeScript reports an assignability failure under several different codes depending on the
  // exact shape of the mismatch (2322 "not assignable", 2741/2739 "missing propert(y/ies)", etc.)
  // -- there is no single fixed code to filter on. Instead, every diagnostic is classified by
  // *position*: the assignment line (always the probe's last line, by construction) is exactly
  // where a real assignability failure is reported; anywhere else (an unresolved import, a syntax
  // problem in a reconstructed type alias) means the probe itself couldn't be trusted, not that
  // the assignment specifically failed.
  //
  // Counted from the actual probe text, not `preambleLines.length`: a
  // reconstructed `fromText`/`toText` can itself span several physical lines
  // (an inline object-literal type, a wrapped long union), which
  // `preambleLines.length` (an element count) does not account for -- and a
  // real "not assignable" diagnostic on the assignment line would then be
  // misfiled as "elsewhere", downgrading a genuine breaking change to
  // "unknown". `assignmentLine` has no newline of its own, so it is always
  // the last physical line.
  const assignmentLineIndex = probeSource.split("\n").length - 1
  const semanticDiagnostics = program.getSemanticDiagnostics(probeFile)

  const diagnosticsElsewhere = semanticDiagnostics.filter((d) => {
    if (d.start === undefined) return true
    return ts.getLineAndCharacterOfPosition(probeFile, d.start).line !== assignmentLineIndex
  })
  if (diagnosticsElsewhere.length > 0) return "unknown"

  return semanticDiagnostics.length > 0 ? "breaking" : "compatible"
}

/**
 * @param context - The baseline/current `.d.ts` rollups, their reference indexes, the old and new excerpts being compared, and the type-parameter names in scope.
 * @param direction - Which direction(s) assignability must hold for the position being checked -- `"contravariant"` (old must accept new, e.g. a parameter type), `"covariant"` (new must accept old, e.g. a return type), or `"invariant"` (both directions, e.g. an invariant generic position).
 * @returns `"compatible"` if every required direction is assignable, the first non-`"compatible"` result (`"breaking"` or `"unknown"`) otherwise, and `"unknown"` if either excerpt couldn't be reconstructed.
 */
export function checkAssignability(
  context: AssignabilityContext,
  direction: AssignabilityDirection,
): AssignabilityResult {
  const oldReconstruction = reconstructTypeExpression(
    context.oldExcerpt,
    context.baselineRefIndex,
    "baseline",
    "__old",
    context.freeTypeParameterNames,
  )
  const newReconstruction = reconstructTypeExpression(
    context.newExcerpt,
    context.currentRefIndex,
    "current",
    "__new",
    context.freeTypeParameterNames,
  )
  if (!oldReconstruction || !newReconstruction) return "unknown"

  const directionsToCheck: readonly {
    readonly from: Reconstruction
    readonly to: Reconstruction
  }[] =
    direction === "contravariant"
      ? [{ from: oldReconstruction, to: newReconstruction }]
      : direction === "covariant"
        ? [{ from: newReconstruction, to: oldReconstruction }]
        : [
            { from: oldReconstruction, to: newReconstruction },
            { from: newReconstruction, to: oldReconstruction },
          ]

  for (const { from, to } of directionsToCheck) {
    const result = probeAssignability({
      baselineDts: context.baselineDts,
      currentDts: context.currentDts,
      imports: [...oldReconstruction.imports, ...newReconstruction.imports],
      fromText: from.text,
      toText: to.text,
    })
    if (result !== "compatible") return result
  }

  return "compatible"
}
