export function npmPack(cwd: string, into: string): string
export function inspectAmbient(input: {
  cwd: string
  tarball?: string
  pack?: (cwd: string, into: string) => string
}): {
  state: "exempt" | "misconfigured" | "unpacked" | "clean" | "violations"
  problems?: string[]
  message?: string
  checked?: number
  violations?: { file: string; capability: string; hit: string }[]
  exempt?: Record<string, string[]>
}
