export function guessSource(key: string, exists: (relative: string) => boolean): string
export function draftSurface(
  pkg: { version?: string; exports?: Record<string, unknown> },
  exists: (relative: string) => boolean,
): {
  entries: Record<string, { source: string; environment: string; tier: string; purpose: string }>
}
export function findApiTable(
  text: string,
): { start: number; end: number; headers: string[]; rows: string[][] } | undefined
export function seedFromTable(
  surface: { entries: Record<string, Record<string, string>> },
  table: { headers: string[]; rows: string[][] },
  packageName: string,
): number
