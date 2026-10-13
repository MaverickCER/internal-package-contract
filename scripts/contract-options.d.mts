export const LOG_MODES: string[]
export const DEFAULT_LOGS: "failing"
export function parseRunOptions(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): { json: boolean; changed: boolean; logs: "all" | "failing" | "off" }
