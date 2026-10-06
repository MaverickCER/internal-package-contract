/* eslint-disable @typescript-eslint/no-explicit-any -- results are plain, user-shaped data; `runSuite` and `analyze` build them and `validateResults` is the real validator. */
export const RESULTS_SCHEMA_VERSION: number
export function generatedBy(env: Record<string, string | undefined>): string
export function agreement(
  measured: string | null,
  expected: string,
): "matches" | "close" | "differs" | "unknown"
export function runSuite(suite: object, options?: object): Promise<any>
export function analyze(input: {
  suite: object
  results: object
  tiers: readonly number[]
  rates?: object
}): any
