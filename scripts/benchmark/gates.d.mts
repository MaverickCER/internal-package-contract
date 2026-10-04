export interface Finding {
  level: "fail" | "note"
  kind: "complexity" | "normalized-overhead" | "environment"
  message: string
}
export interface Gates {
  complexity: boolean
  normalizedOverheadMaxIncreasePercent: {
    millisecondScale: number
    microsecondScale: number
    microscaleBelowMs: number
  }
  noiseFloorBaselineMs: number
}
export const DEFAULT_GATES: Gates
export function resolveGates(
  overrides?: Partial<Omit<Gates, "normalizedOverheadMaxIncreasePercent">> & {
    normalizedOverheadMaxIncreasePercent?: Partial<Gates["normalizedOverheadMaxIncreasePercent"]>
  },
): Gates
export function complexityFindings(current: object | undefined): Finding[]
export function overheadFindings(
  current: object | undefined,
  references: { name: string; results: object | null | undefined }[],
  gates: Gates,
): Finding[]
export function environmentNotes(
  previous: object | null | undefined,
  current: object | undefined,
): Finding[]
export function evaluateGates(input: {
  previous?: object | null
  release?: object | null
  current?: object
  gates?: object
}): Finding[]
