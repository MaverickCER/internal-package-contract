type Measurements = Record<
  string,
  Record<string, { medianMs: number; inputs?: Record<string, number> }>
>
export function groupKind(
  name: string,
): "baseline" | "with-package" | "derived-overhead" | "function" | undefined
export function isDerivedGroup(name: string): boolean
export function packageCostRows(
  measurements: Measurements | undefined,
  tierOrder: readonly string[],
  noiseFloorMs: number,
): {
  tier: string
  size: number | null
  baselineMs: number
  withPackageMs: number
  addedMs: number
  relativePercent: number | null
}[]
export function describeProvenance(
  runs: readonly { commit: string | null; runner: string | null; cpuModel: string | null }[],
): string
