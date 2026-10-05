export function collectEnvironment(): {
  cpuModel: string | null
  processArch: string
  logicalCores: number
  physicalCores: number | null
  platform: string
  osRelease: string
  totalMemoryMb: number
  nodeVersion: string
  isCI: boolean
  runner: string
}
export function collectGit(root: string): {
  gitCommit: string | null
  gitBranch: string | null
  gitDirty: boolean | null
}
export function collectBundleSizes(
  root: string,
  files: readonly string[],
): Record<string, { bytes: number | null; gzipBytes: number | null }>
export function physicalCores(
  platform: string,
  exec: (command: string, args: string[], options: object) => string,
  read: (file: string, encoding: string) => string,
): number | null
export interface System {
  cpus: readonly { model?: string }[]
  arch: string
  physicalCores: number | null
  platform: string
  release: string
  totalMemoryBytes: number
  nodeVersion: string
  env: Readonly<Record<string, string | undefined>>
}
export function describeEnvironment(system: System): ReturnType<typeof collectEnvironment>
export function gitState(
  root: string,
  exec: (command: string, args: string[], options: object) => string,
): ReturnType<typeof collectGit>
