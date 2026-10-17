// Hand-authored type declarations for classify-complexity.mjs -- this
// package's own `Typecheck` check (`tsc --noEmit -p tsconfig.self.json`,
// see repo-contract.config.ts) requires every `.ts` file it type-checks
// (including test/**/*.test.ts, which imports this module directly for
// thorough unit coverage) to resolve a declaration for every import; without
// `allowJs` enabled repo-wide, a sibling `.d.mts` is the narrowly-scoped fix
// -- NodeNext module resolution matches a `.mjs` source file to a `.d.mts`
// declaration of the exact same basename.

export interface SizeSeriesPoint {
  readonly tier: string
  readonly size: number
  readonly medianMs: number
}

export interface ClassificationResult {
  readonly complexityClass: string | null
  readonly exponent: number | null
  readonly points: number
  readonly rSquared?: number
  readonly reason?: "insufficient-data" | "no-size-variation" | "poor-fit"
  /** Why each unusable tier was left out (only for `insufficient-data`). */
  readonly discarded?: readonly { tier: string; why: string }[]
  /** The one size every usable tier shares (only for `no-size-variation`). */
  readonly size?: number
}

export interface GrowthFit {
  readonly exponent: number
  readonly rSquared: number
  readonly flat: boolean
  readonly points: number
}

export interface ComplexityShiftResult {
  readonly shifted: boolean
  readonly previousClass: string | null
  readonly currentClass: string | null
  readonly previousExponent: number | null
  readonly currentExponent: number | null
}

export interface TierMeasurement {
  readonly medianMs?: number
  readonly inputs?: Readonly<Record<string, unknown>>
}

export type TierMeasurements = Readonly<Record<string, TierMeasurement | undefined>>

export const COMPLEXITY_CLASSES: readonly string[]
export const FIT_WINDOW: number
export const MIN_R_SQUARED: number

export function inputTotal(
  inputs: Readonly<Record<string, unknown>> | undefined | null,
): number | undefined

export function discardedTiers(tiers: TierMeasurements | undefined): { tier: string; why: string }[]

export function buildSizeSeries(tiers: TierMeasurements | undefined): SizeSeriesPoint[]

export function estimateGrowthExponent(
  series: readonly Pick<SizeSeriesPoint, "size" | "medianMs">[] | undefined,
): number | null

export function fitGrowth(
  series: readonly Pick<SizeSeriesPoint, "size" | "medianMs">[],
): GrowthFit | null

export function snapExponentToClass(exponent: number): string

export function classifyGroup(tiers: TierMeasurements): ClassificationResult

export function detectComplexityShift(
  previousTiers: TierMeasurements | undefined,
  currentTiers: TierMeasurements | undefined,
): ComplexityShiftResult
export const SHIFT_MARGIN: number
export function movedByMargin(previousExponent: number, currentExponent: number): boolean
