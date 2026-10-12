export function tarballFiles(gzipped: Buffer): string[]
export function targetFiles(target: unknown): string[]
export function entryPoints(manifest: {
  name: string
  exports?: unknown
  main?: string
}): { specifier: string; require: boolean; json: boolean }[]
export function promisedFiles(manifest: {
  exports?: unknown
  main?: string
  bin?: string | Record<string, string>
}): string[]
export function missingFromTarball(promised: readonly string[], packed: readonly string[]): string[]
export function missingPackage(output: string): string | undefined
export function classifyFailure(
  output: string,
  manifest: {
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, unknown>
  },
): { kind: "peer"; peer: string } | { kind: "broken"; reason: string }
