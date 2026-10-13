export interface AmbientConfig {
  child_process?: string[]
  fs?: string[]
  env?: string[]
  forbiddenDependencies?: string[]
}
export interface AmbientViolation {
  file: string
  capability: string
  hit: string
}
export const CAPABILITIES: Readonly<Record<"child_process" | "fs" | "env", object>>
export const DEFAULT_CONFIG: Readonly<Required<AmbientConfig>>
export function normalizeConfig(raw: unknown): { config: AmbientConfig; problems: string[] }
export function exemptFiles(
  manifest: { bin?: unknown; exports?: Record<string, unknown> },
  entries: readonly string[],
): Set<string>
export function scanFiles(input: {
  files: { name: string; content: Buffer }[]
  manifest: {
    bin?: unknown
    exports?: Record<string, unknown>
    dependencies?: Record<string, string>
    bundleDependencies?: string[]
  }
  config: AmbientConfig
}): {
  violations: AmbientViolation[]
  exempt: Record<string, string[]>
  checked: number
}
