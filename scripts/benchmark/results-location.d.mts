export const LOCAL_DIRECTORY: string
export function isCi(env: Record<string, string | undefined>): boolean
export function defaultOutput(
  suiteDirectory: string,
  env: Record<string, string | undefined>,
): string
export function currentResults(cwd: string, suite: string): string | undefined
export function suiteDirectories(cwd: string): string[]
