export const COMPILER_MARKERS: readonly string[]
export function entryFiles(entry: unknown): string[]
export function specifiers(source: string): string[]
export function closure(start: string): { files: Map<string, string>; external: Set<string> }
export function inspectIsolation(
  root: string,
  pkg: { bin?: string | Record<string, string>; exports: Record<string, unknown> },
): { problems: string[]; clients: number }
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): number
