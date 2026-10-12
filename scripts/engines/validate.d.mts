export function minimumNodeMajor(range: unknown): number | undefined
export function testedVersions(text: string): string[]
export function judgeEngineMatrix(
  manifest: { engines?: { node?: unknown } },
  workflows: readonly string[],
): {
  state: "ok" | "no-engines" | "unreadable" | "untested"
  minimum?: number
  tested?: number[]
}
