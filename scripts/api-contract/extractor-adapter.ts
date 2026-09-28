import { Extractor, ExtractorConfig } from "@microsoft/api-extractor"
import type { ExtractorMessage, IConfigFile } from "@microsoft/api-extractor"
import { ApiModel } from "@microsoft/api-extractor-model"
import type { ApiPackage } from "@microsoft/api-extractor-model"
import path from "node:path"

import type { ApiContractTarget } from "./targets.js"

/**
 * Adapted from repo-contract's own `scripts/api-contract/extractor-adapter.ts` -- `runApiExtractor`
 * is unchanged; `runApiExtractorForRoot` (which hardcoded repo-contract's own single entry point)
 * is replaced by `runApiExtractorForTarget`, namespacing output per target (see targets.ts) since a
 * consumer here may declare several public entry points.
 *
 * The only file in this feature that imports `@microsoft/api-extractor`/
 * `@microsoft/api-extractor-model` directly -- the small internal adapter that isolates the rest of
 * the feature from API Extractor's own implementation details. Builds its `IConfigFile`
 * programmatically via `ExtractorConfig.prepare` rather than requiring a hand-authored
 * `api-extractor.json`, since every setting this feature needs is already derivable from the
 * consumer's own conventions (the entry point, the root tsconfig.json).
 */
interface RunExtractorOptions {
  /** Absolute path to the consumer's project root. */
  readonly projectFolder: string
  /** Relative to `projectFolder`, e.g. "dist/.dts/runtime/index.d.ts". */
  readonly mainEntryPointFilePath: string
  /** Absolute path, reused as-is from the consumer's own root tsconfig.json. */
  readonly tsconfigFilePath: string
  /** Absolute path to write the current Doc Model JSON. */
  readonly apiJsonFilePath: string
  /** Absolute path to write the current, untrimmed, self-contained .d.ts rollup -- what the TypeChecker probe analyzes. */
  readonly dtsRollupFilePath: string
  /** Absolute folder to write the current human-readable API report into. */
  readonly apiReportFolder: string
  /** Base file name (no extension) for the API report, e.g. "current" -> current.api.md. */
  readonly apiReportFileName: string
}

interface RunExtractorResult {
  readonly succeeded: boolean
  readonly errorCount: number
  readonly warningCount: number
  readonly apiJsonFilePath: string
  readonly dtsRollupFilePath: string
  readonly apiReportFilePath: string
}

/**
 * Runs API Extractor's programmatic API (never the CLI) to produce, in one pass: the Doc Model
 * JSON (`.api.json`, the canonical machine-readable contract), a fully self-contained `.d.ts`
 * rollup (what `type-assignability.ts`'s TypeChecker probe analyzes), and the human-readable API
 * report (`.api.md`, discarded by this feature's own callers -- kept only because API Extractor
 * always produces one). Suppresses API Extractor's own default STDOUT/STDERR-writing message
 * behavior (it would otherwise corrupt this check's pure-JSON stdout contract) by supplying an
 * explicit `messageCallback` that routes everything to stderr instead.
 * @param options - Where to read the entry point/tsconfig from and where to write the Doc Model JSON, `.d.ts` rollup, and API report.
 * @returns Whether the extraction succeeded, its error/warning counts, and the absolute paths of the three files it wrote.
 */
export function runApiExtractor(options: RunExtractorOptions): RunExtractorResult {
  const configObject: IConfigFile = {
    projectFolder: options.projectFolder,
    mainEntryPointFilePath: options.mainEntryPointFilePath,
    compiler: {
      tsconfigFilePath: options.tsconfigFilePath,
    },
    apiReport: {
      enabled: true,
      reportFileName: options.apiReportFileName,
      reportFolder: options.apiReportFolder,
      reportTempFolder: options.apiReportFolder,
    },
    docModel: {
      enabled: true,
      apiJsonFilePath: options.apiJsonFilePath,
      // API Extractor's own default (`releaseTagsToTrim: ['@internal']`) would trim @internal
      // items out of the Doc Model at extraction time, before model-normalizer.ts's own
      // --release-tag threshold ever sees them -- silently defeating the "single, testable,
      // parameterized concern in one place" this feature deliberately keeps in
      // model-normalizer.ts. Trimming nothing here means .api.json always retains every release
      // tier; model-normalizer.ts remains the sole filtering point.
      releaseTagsToTrim: [],
    },
    dtsRollup: {
      enabled: true,
      untrimmedFilePath: options.dtsRollupFilePath,
    },
  }

  const extractorConfig = ExtractorConfig.prepare({
    configObject,
    configObjectFullPath: undefined,
    packageJsonFullPath: path.join(options.projectFolder, "package.json"),
    projectFolderLookupToken: options.projectFolder,
  })

  const result = Extractor.invoke(extractorConfig, {
    localBuild: true,
    messageCallback: (message: ExtractorMessage) => {
      process.stderr.write(`[api-extractor] ${message.text}\n`)
      message.handled = true
    },
  })

  return {
    succeeded: result.succeeded,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    apiJsonFilePath: options.apiJsonFilePath,
    dtsRollupFilePath: options.dtsRollupFilePath,
    apiReportFilePath: path.join(options.apiReportFolder, `${options.apiReportFileName}.api.md`),
  }
}

/**
 * Invokes `runApiExtractor` against one target's own entry point, writing scratch output under
 * `<root>/.repo-contract/api-contract/<target.name>/` -- shared by `check.ts` and
 * `update-baseline.ts`, which both extract the exact same "current" snapshot for a given target.
 * @param root - Absolute path to the consumer's project root; must contain a built `dist/` and `tsconfig.json`.
 * @param target - The entry point to extract (see targets.ts).
 * @returns The same result `runApiExtractor` returns.
 */
export function runApiExtractorForTarget(
  root: string,
  target: ApiContractTarget,
): RunExtractorResult {
  const outDir = path.join(root, ".repo-contract", "api-contract", target.name)
  return runApiExtractor({
    projectFolder: root,
    mainEntryPointFilePath: target.mainEntryPointFilePath,
    tsconfigFilePath: path.join(root, "tsconfig.json"),
    apiJsonFilePath: path.join(outDir, "current.api.json"),
    dtsRollupFilePath: path.join(outDir, "current.d.ts"),
    apiReportFolder: outDir,
    apiReportFileName: "current",
  })
}

/**
 * Loads a `.api.json` Doc Model file into a real `ApiModel`/`ApiPackage` -- never treated as untyped JSON beyond this one call.
 * @param apiJsonFilePath - Absolute path to the `.api.json` Doc Model file to load.
 * @returns The loaded `ApiModel` and its single top-level `ApiPackage`.
 */
export function loadApiModel(apiJsonFilePath: string): { model: ApiModel; pkg: ApiPackage } {
  const model = new ApiModel()
  const pkg = model.loadPackage(apiJsonFilePath)
  return { model, pkg }
}

/**
 * @returns The installed `@microsoft/api-extractor` package version, recorded as provenance metadata alongside each baseline/current snapshot.
 */
export function getApiExtractorVersion(): string {
  return Extractor.version
}
