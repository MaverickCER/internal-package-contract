export const SOURCE_FILE: RegExp
export const GENERATED: string[]
export function candidates(from: string, specifier: string): string[]
export function untrackedImports(input: {
  files: Record<string, string>
  tracked: ReadonlySet<string>
  existsOnDisk: (file: string) => boolean
}): { file: string; specifier: string; target: string }[]
