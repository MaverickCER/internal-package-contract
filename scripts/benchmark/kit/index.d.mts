/* eslint-disable @typescript-eslint/no-explicit-any -- suites and results are plain, user-shaped data (`defineSuite` and `validateResults` are the real validators); typing every nested figure would only force casts on every consumer and test. */
// Hand-authored declarations for the benchmark kit (see classify-complexity.d.mts for why a sibling
// `.d.mts` is used instead of `allowJs`). Suites are plain `.mjs`, so the shapes are intentionally
// permissive; `defineSuite` is the real validator.

export type ComplexityClass =
  "constant" | "logarithmic" | "linear" | "linearithmic" | "quadratic" | "cubic-or-worse"

export const COMPLEXITY_NOTATION: Readonly<Record<ComplexityClass, string>>
export function expectationOf(
  fn: any,
  variant?: any,
): { expectedComplexity: ComplexityClass; complexityReason: string }
export class SuiteDefinitionError extends Error {
  readonly problems: readonly string[]
}

export interface SuiteVariable {
  name: string
  description: string
  how: "swept" | "variant" | "fixed"
  value?: unknown
}
export interface SuiteBenchmark {
  id: string
  name: string
  why: string
  poorPerformanceMeans: string
  expectedComplexity: ComplexityClass
  complexityReason: string
  variables: SuiteVariable[]
  variants?: {
    name: string
    description: string
    options?: unknown
    expectedComplexity?: ComplexityClass
    complexityReason?: string
  }[]
  notCovered?: { name: string; reason: string }[]
  inEndToEnd?:
    | {
        callsPerOperation: number | ((n: number) => number)
        includes?: string[]
        description: string
        variant?: string
      }
    | undefined
  tiers?: readonly number[]
  tiersReason?: string
  fresh?: boolean
  sampling?: {
    warmupIterations?: number
    targetDurationMs?: number
    minIterations?: number
    maxIterations?: number
    minSampleMs?: number
  }
  setup?: (n: number, options?: unknown) => unknown
  run?: (ctx: any) => unknown
  call?: (...args: any[]) => unknown
  input?: (n: number, options?: unknown) => unknown[]
  teardown?: (ctx: any) => unknown
}
export interface SuiteSide {
  description: string
  fresh?: boolean
  sampling?: SuiteBenchmark["sampling"]
  setup?: (n: number) => unknown
  run?: (ctx: any) => unknown
  call?: (...args: any[]) => unknown
  input?: (n: number, options?: unknown) => unknown[]
  teardown?: (ctx: any) => unknown
}
export interface Suite {
  package: { name: string; version?: string; bundleFiles?: string[] }
  workload: { unit: string; description: string; typicalN?: number }
  tiers?: readonly number[]
  endToEnd: {
    purpose: string
    baseline: SuiteSide
    withPackage: SuiteSide
    variables?: SuiteVariable[]
  }
  functions: SuiteBenchmark[]
}
export function defineSuite(suite: Suite): Suite & { tiers: readonly number[] }

export const STANDARD_TIERS: readonly number[]
export const QUICK_TIERS: readonly number[]
export function tierName(size: number): string
export function validateTiers(tiers: readonly number[], minimum?: number): string[]

export interface DurationStats {
  minMs: number
  medianMs: number
  p95Ms: number
  maxMs: number
  stdDevMs: number
  iterations: number
  warmupIterations: number
}
export function computeDurationStats(
  values: readonly number[],
  warmupIterations: number,
): DurationStats
export function percentile(sorted: readonly number[], p: number): number
export function timed(ms: number): object
export function snapshotMemory(): { rssBytes: number; heapUsedBytes: number }
export function sample(
  iteration: () => unknown,
  options?: {
    warmupIterations?: number
    targetDurationMs?: number
    minIterations?: number
    maxIterations?: number
    minSampleMs?: number
    prepare?: () => unknown
    release?: () => unknown
  },
): Promise<{
  wallMs: number[]
  cpuMs: number[]
  heapDeltaBytes: number[]
  configuration: Record<string, unknown>
}>

export const DEFAULT_RATES: { vCpuHourUsd: number; gbSecondUsd: number; minMemoryMb: number }
export function estimateCost(
  operation: { wallMs: number; cpuMs: number; heapBytes?: number },
  rates?: Partial<{ vCpuHourUsd: number; gbSecondUsd: number; minMemoryMb: number }>,
): { lowUsdPerMillion: number; highUsdPerMillion: number; opsPerSecondPerCore: number }
export function formatUsd(usd: number): string

export const RESULTS_SCHEMA_VERSION: number
export function agreement(
  measured: string | null,
  expected: string,
): "matches" | "close" | "differs" | "unknown"
export function analyze(input: {
  suite: any
  results: any
  tiers: readonly number[]
  rates?: object
}): any
export function runSuite(suite: any, options?: any): Promise<any>
export function renderReport(results: any, suite: any, options?: { docsPath?: string }): string
export function formatMs(ms: number): string
export function formatBytes(bytes: number): string
export function validateResults(results: unknown): string[]
