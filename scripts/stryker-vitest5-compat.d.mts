export const LEGACY_JOIN: string
export const VITEST_5_JOIN: string
export const UPSTREAM_FIX_MARKER: string
export const RUNNER_FILES: readonly string[]

export function tempPathFor(file: string, pid: number): string

export function writeFileAtomically(
  file: string,
  text: string,
  ops?: { write(file: string, text: string): void; rename(from: string, to: string): void },
): void

export function majorOf(version: string): number | undefined

export function classify(
  text: string,
): "patched" | "needs-patch" | "upstream-fixed" | "unrecognised"

export function ancestorsOf(cwd: string): string[]

export function findPackageDir(
  cwd: string,
  name: string,
  exists: (file: string) => boolean,
): string | undefined

export interface CompatIo {
  exists(file: string): boolean
  readFile(file: string): string
  writeFile(file: string, text: string): void
}

export interface CompatResult {
  status: "not-needed" | "patched" | "already-patched" | "upstream-fixed" | "unrecognised"
  vitestVersion: string | undefined
  patched: string[]
}

export function ensureStrykerVitest5Compat(cwd: string, io?: CompatIo): CompatResult
