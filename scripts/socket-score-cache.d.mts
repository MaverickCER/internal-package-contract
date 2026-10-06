export function cacheDir(env: Record<string, string | undefined>): string | undefined
export function cacheTtlMs(env: Record<string, string | undefined>): number
export function isTrustedDir(dir: string): boolean
export function isValidEntry(entry: unknown, name: string, version: string): boolean
export function readCached(
  dir: string | undefined,
  name: string,
  version: string,
  ttlMs: number,
  now: number,
): object | undefined
export function writeCached(
  dir: string | undefined,
  name: string,
  version: string,
  data: object,
  now: number,
): void
