export const REGISTRY_RELATIVE_PATH: string
export const REQUIRED_FIELDS: readonly string[]
export interface Gain {
  suite: string
  group: string
  previousClass: string
  currentClass: string
  previousExponent: number
  currentExponent: number
}
export function classRank(complexityClass: string | null | undefined): number
export function complexityGains(
  suite: string,
  baseline: object | null | undefined,
  current: object | null | undefined,
): Gain[]
export function gainExceptionId(suite: string, group: string, toClass: string): string
export function describeGain(gain: Gain): string
export function missingFields(record: Record<string, unknown>, now: Date): string[]
export function judgeGains(
  gains: readonly Gain[],
  records: readonly Record<string, unknown>[],
  now: Date,
): {
  accepted: { gain: Gain; id: string }[]
  unaccepted: { gain: Gain; id: string; reason: string }[]
}
