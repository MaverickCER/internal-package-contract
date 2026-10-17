export function publishedEntries(exportsMap: Record<string, unknown>): string[]
export function specifier(name: string, key: string): string
export function entryPointRows(
  pkg: { name: string; exports?: Record<string, unknown> },
  surface: unknown,
): { problems: string[]; rows: string[][] }
export function toTable(rows: string[][]): string
