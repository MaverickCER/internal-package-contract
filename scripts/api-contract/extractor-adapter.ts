import { Extractor, ExtractorConfig } from "@microsoft/api-extractor"
import type { ExtractorMessage, IConfigFile } from "@microsoft/api-extractor"
import { ApiModel } from "@microsoft/api-extractor-model"
import type { ApiPackage } from "@microsoft/api-extractor-model"
import { rmSync } from "node:fs"
import path from "node:path"

import type { ApiContractTarget } from "./targets.js"

/**
 * Adapted from repo-contract's `scripts/api-contract/extractor-adapter.ts`. `runApiExtractor` is
 * unchanged. `runApiExtractorForTarget` replaces `runApiExtractorForRoot`, which hardcoded
 * repo-contract's single entry point. A consumer here may declare several public entry points, so
 * output is kept per target (see targets.ts).
 *
 * The only file in this feature that imports `@microsoft/api-extractor` or
 * `@microsoft/api-extractor-model`. It keeps API Extractor's details out of the rest of the
 * feature. It builds its `IConfigFile` with `ExtractorConfig.prepare`, not from a hand-authored
 * `api-extractor.json`. Every setting it needs follows from the consumer's entry point and root
 * tsconfig.json.
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
  /** Absolute path to write the current, untrimmed, self-contained .d.ts rollup: what the TypeChecker probe analyzes. */
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
 * Runs API Extractor's programmatic API (never the CLI) to produce three files in one pass. They
 * are the Doc Model JSON (`.api.json`, the canonical machine-readable contract) and a fully
 * self-contained `.d.ts` rollup (what `type-assignability.ts`'s TypeChecker probe analyzes). The
 * third is the human-readable API report (`.api.md`, discarded by this feature's own callers; kept
 * only because API Extractor always produces one). An explicit `messageCallback` routes every
 * API Extractor message to stderr. By default those messages reach stdout, which must carry only
 * this check's JSON.
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
      // --release-tag threshold ever sees them. That would silently defeat the "single, testable,
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
    // Stryker disable next-line BooleanLiteral: the report folder and its temp folder are the same here, so the production-build comparison of the two reports always passes
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
 * Removes a target's `current.api.json` and `current.d.ts`. `BenchmarkCoverage` reads them
 * (scripts/benchmark/coverage/scan.mjs), so only a successful extraction may leave them.
 * @param root - Absolute path to the consumer's project root.
 * @param target - The target whose current API is removed (see targets.ts).
 */
export function removeCurrentApi(root: string, target: ApiContractTarget): void {
  const outDir = path.join(root, ".repo-contract", "api-contract", target.name)
  for (const file of ["current.api.json", "current.d.ts"])
    rmSync(path.join(outDir, file), { force: true })
}

/**
 * Runs `runApiExtractor` on one target's entry point, writing scratch output under
 * `<root>/.repo-contract/api-contract/<target.name>/`. `check.ts` and `update-baseline.ts` both
 * call it, so both extract the same "current" snapshot of a target. The last run's
 * `current.api.json` and `current.d.ts` are removed first, and this run's are removed again
 * unless it succeeds, whether it reports errors or throws.
 * @param root - Absolute path to the consumer's project root; must contain a built `dist/` and `tsconfig.json`.
 * @param target - The entry point to extract (see targets.ts).
 * @returns The same result `runApiExtractor` returns.
 */
export function runApiExtractorForTarget(
  root: string,
  target: ApiContractTarget,
): RunExtractorResult {
  const outDir = path.join(root, ".repo-contract", "api-contract", target.name)
  removeCurrentApi(root, target)
  let succeeded = false
  try {
    const result = runApiExtractor({
      projectFolder: root,
      mainEntryPointFilePath: target.mainEntryPointFilePath,
      tsconfigFilePath: path.join(root, "tsconfig.json"),
      apiJsonFilePath: path.join(outDir, "current.api.json"),
      dtsRollupFilePath: path.join(outDir, "current.d.ts"),
      apiReportFolder: outDir,
      apiReportFileName: "current",
    })
    succeeded = result.succeeded
    return result
  } finally {
    if (!succeeded) removeCurrentApi(root, target)
  }
}

/**
 * Loads a `.api.json` Doc Model file into a real `ApiModel`/`ApiPackage`: never treated as untyped JSON beyond this one call.
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
