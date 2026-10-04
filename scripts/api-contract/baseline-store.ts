import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/**
 * Adapted from repo-contract's own `scripts/api-contract/baseline-store.ts` -- namespaced per
 * target (a consumer may have several public entry points, each with its own independent
 * baseline) under `.repo-contract/api-contract/<target>/`, instead of one fixed directory.
 *
 * The only file that touches `.repo-contract/api-contract/` on disk. The committed baseline is
 * authoritative: `readBaseline` reads it from git `HEAD` via `git show`, never the working tree,
 * so an uncommitted local edit (accidental or deliberate) never affects the historical comparison.
 * `writeBaselineFiles` is the single implementation that ever writes a baseline -- shared by
 * check.ts's initial-baseline bootstrap (the only situation the check itself may write one) and
 * the separate, human-invoked update-baseline.ts.
 */

interface BaselineMeta {
  readonly packageName: string
  /** Provenance metadata about this snapshot -- the package version it was captured at -- not a property of the TypeScript contract itself. */
  readonly packageVersion: string
  readonly apiExtractorVersion: string
  readonly apiJsonSchemaVersion: number
  /** Identity of the historical public contract itself. */
  readonly apiJsonHash: string
  /** Integrity of the compiler artifact used to analyze it -- baseline.d.ts is a derived supporting artifact, never independently authoritative. */
  readonly dtsHash: string
  /** Metadata only -- never part of a hash or the semantic comparison. */
  readonly generatedAt: string
}

interface Baseline {
  readonly apiJsonText: string
  readonly dtsText: string
  readonly meta: BaselineMeta
}

/**
 * @param target - This target's name (see targets.ts).
 * @returns The repository-relative directory this target's baseline files live under.
 */
function baselineDir(target: string): string {
  return path.posix.join(".repo-contract", "api-contract", target)
}

/**
 * @param content - The text to hash.
 * @returns The hex-encoded sha256 digest of `content`.
 */
export function sha256(content: string): string {
  // Line endings are not content: a Windows checkout with `core.autocrlf` rewrites a committed LF
  // baseline to CRLF, which must not read as "manually edited".
  return createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex")
}

/**
 * Throws the same "corrupted baseline" error this module already throws for a hash mismatch if
 * `value` doesn't have every `BaselineMeta` field with the right primitive type.
 * @param value - The parsed `baseline.meta.json` content to validate.
 * @param target - This target's name, for the error message.
 * @throws {Error} If `value` is not an object, or any `BaselineMeta` field is missing or has the wrong type.
 */
function assertValidBaselineMeta(value: unknown, target: string): asserts value is BaselineMeta {
  if (typeof value !== "object" || value === null) {
    throw new Error(
      `${baselineDir(target)}/baseline.meta.json is corrupted or was manually edited (not a JSON object). Regenerate it with the update-baseline command.`,
    )
  }
  const meta = value as Record<string, unknown>
  const stringFields = [
    "packageName",
    "packageVersion",
    "apiExtractorVersion",
    "apiJsonHash",
    "dtsHash",
    "generatedAt",
  ] as const
  for (const field of stringFields) {
    if (typeof meta[field] !== "string") {
      throw new Error(
        `${baselineDir(target)}/baseline.meta.json is corrupted or was manually edited ("${field}" must be a string). Regenerate it with the update-baseline command.`,
      )
    }
  }
  if (typeof meta["apiJsonSchemaVersion"] !== "number") {
    throw new Error(
      `${baselineDir(target)}/baseline.meta.json is corrupted or was manually edited ("apiJsonSchemaVersion" must be a number). Regenerate it with the update-baseline command.`,
    )
  }
}

/**
 * @param apiJsonText - The raw API Extractor JSON text to read.
 * @returns The API JSON's `metadata.schemaVersion`, or `0` if absent.
 */
export function readSchemaVersion(apiJsonText: string): number {
  let parsed: { metadata?: { schemaVersion?: number } }
  try {
    parsed = JSON.parse(apiJsonText) as { metadata?: { schemaVersion?: number } }
  } catch {
    throw new Error(
      "The API Extractor JSON report is not valid JSON (a truncated or interrupted write?). Regenerate it with `npm run build` and re-run the check.",
    )
  }
  return parsed.metadata?.schemaVersion ?? 0
}

/**
 * Reads and parses `<root>/package.json` for the `name`/`version` fields this feature needs --
 * shared by `check.ts` and `update-baseline.ts`, which both previously duplicated this read.
 * @param root - Absolute path to the package's project folder.
 * @returns The package's `name` and `version`.
 */
export async function readPackageJson(root: string): Promise<{ name: string; version: string }> {
  const raw = await readFile(path.join(root, "package.json"), "utf8")
  try {
    return JSON.parse(raw) as { name: string; version: string }
  } catch {
    throw new Error(
      `${path.join(root, "package.json")} is not valid JSON -- fix it before running the api-contract check.`,
    )
  }
}

/**
 * Throws if `root` is not inside a git working tree at all -- the one case that must fail loudly rather than silently proceeding as "no baseline yet".
 * @param root - Path to the working tree to check.
 */
async function assertInsideGitWorkTree(root: string): Promise<void> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root })
  } catch (error) {
    throw new Error(
      `"${root}" is not inside a git working tree -- the committed baseline can only be read from git, ` +
        "and this check refuses to fall back to an untrusted working-tree copy.",
      { cause: error },
    )
  }
}

/**
 * Reads one file from git `HEAD`. Returns `undefined` for any reason the read couldn't complete
 * once we already know this is a real git repository -- an unborn `HEAD` (no commits yet, e.g. a
 * brand-new repository) and a `HEAD` that exists but doesn't contain this path both mean the same
 * thing here: no baseline is committed yet.
 * @param root - Path to the git working tree.
 * @param relativePath - Path of the file to read, relative to `root`.
 * @returns The file's content at `HEAD`, or `undefined` if it couldn't be read.
 */
async function readFileAtHead(root: string, relativePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `HEAD:${relativePath}`], {
      cwd: root,
      maxBuffer: 1024 * 1024 * 64,
    })
    return stdout
  } catch {
    return undefined
  }
}

/**
 * Reads this target's committed baseline from git `HEAD` and verifies its integrity. Returns
 * `undefined` only when no baseline is committed yet (the initial-baseline case) -- any other
 * failure (not a git repository, a hash mismatch between `baseline.meta.json` and its content
 * files) throws explicitly rather than silently falling back to an untrusted state.
 * @param root - Path to the git working tree containing the committed baseline.
 * @param target - This target's name (see targets.ts).
 * @returns The committed baseline's contents and metadata, or `undefined` if none is committed yet.
 */
export async function readBaseline(root: string, target: string): Promise<Baseline | undefined> {
  await assertInsideGitWorkTree(root)

  const dir = baselineDir(target)
  const metaText = await readFileAtHead(root, path.posix.join(dir, "baseline.meta.json"))
  if (metaText === undefined) return undefined

  let meta: unknown
  try {
    meta = JSON.parse(metaText)
  } catch {
    throw new Error(
      `${dir}/baseline.meta.json is not valid JSON (a truncated or interrupted write?). Regenerate it with the update-baseline command.`,
    )
  }
  assertValidBaselineMeta(meta, target)
  const apiJsonText = await readFileAtHead(root, path.posix.join(dir, "baseline.api.json"))
  const dtsText = await readFileAtHead(root, path.posix.join(dir, "baseline.d.ts"))
  if (apiJsonText === undefined || dtsText === undefined) {
    throw new Error(
      `${dir}/baseline.meta.json exists at HEAD but baseline.api.json/baseline.d.ts do not -- the committed baseline is incomplete.`,
    )
  }

  if (sha256(apiJsonText) !== meta.apiJsonHash) {
    throw new Error(
      `${dir}/baseline.api.json's content does not match the hash recorded in baseline.meta.json -- the committed baseline is corrupted or was manually edited. Regenerate it with the update-baseline command.`,
    )
  }
  if (sha256(dtsText) !== meta.dtsHash) {
    throw new Error(
      `${dir}/baseline.d.ts's content does not match the hash recorded in baseline.meta.json -- the committed baseline is corrupted or was manually edited. Regenerate it with the update-baseline command.`,
    )
  }

  return { apiJsonText, dtsText, meta }
}

interface WriteBaselineInput {
  readonly apiJsonText: string
  readonly dtsText: string
  readonly packageName: string
  readonly packageVersion: string
  readonly apiExtractorVersion: string
  readonly apiJsonSchemaVersion: number
}

/**
 * Writes `content` to `filePath` such that the final filename never observably holds partial
 * content: written to a sibling temp file first (same directory, so the following `rename` is
 * guaranteed to be same-filesystem and therefore atomic), then renamed into place.
 * @param filePath - Absolute path of the file to write.
 * @param content - The full content to write.
 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${randomUUID()}`
  await writeFile(tempPath, content, "utf8")
  await rename(tempPath, filePath)
}

/**
 * Writes `.repo-contract/api-contract/<target>/baseline.*` into the working tree. Never called by
 * the check itself except to bootstrap the very first baseline for a target; every other call is
 * from the explicitly human-invoked update-baseline command.
 * @param root - Path to the working tree to write the baseline files into.
 * @param target - This target's name (see targets.ts).
 * @param input - The API JSON/d.ts text and provenance metadata to write and hash.
 */
export async function writeBaselineFiles(
  root: string,
  target: string,
  input: WriteBaselineInput,
): Promise<void> {
  const meta: BaselineMeta = {
    packageName: input.packageName,
    packageVersion: input.packageVersion,
    apiExtractorVersion: input.apiExtractorVersion,
    apiJsonSchemaVersion: input.apiJsonSchemaVersion,
    apiJsonHash: sha256(input.apiJsonText),
    dtsHash: sha256(input.dtsText),
    generatedAt: new Date().toISOString(),
  }

  const dir = path.join(root, baselineDir(target))
  await mkdir(dir, { recursive: true })
  await writeFileAtomic(path.join(dir, "baseline.api.json"), input.apiJsonText)
  await writeFileAtomic(path.join(dir, "baseline.d.ts"), input.dtsText)
  await writeFileAtomic(path.join(dir, "baseline.meta.json"), `${JSON.stringify(meta, null, 2)}\n`)
}
