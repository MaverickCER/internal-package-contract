export const ALWAYS: string[]
export const DOCUMENTATION: string[]
export const WORKFLOWS: string[]
export function selectChanged(
  files: readonly string[],
  available: readonly string[],
): { ids: string[] | undefined; reason: string }
export function changedFiles(
  cwd: string,
  git?: (args: string[]) => string | undefined,
): string[] | undefined
export function gitIn(cwd: string): (args: string[]) => string | undefined
