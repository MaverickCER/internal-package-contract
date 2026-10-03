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
