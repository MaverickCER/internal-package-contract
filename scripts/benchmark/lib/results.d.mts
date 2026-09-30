// Hand-authored type declarations for lib/results.mjs -- see
// ../classify-complexity.d.mts's own doc comment for why these exist.

export interface DurationLike {
  readonly medianMs?: number
}

export interface RawTierEntry {
  readonly status?: string
  readonly totalMs?: DurationLike
  readonly durationMs?: DurationLike | number
  readonly inputs?: Readonly<Record<string, unknown>>
  readonly reason?: string
  readonly error?: { readonly name?: string; readonly message?: string }
}

export interface RawResultsJson {
  readonly metadata?: {
    readonly timing?: { readonly finishedAtUtc?: string }
    readonly git?: { readonly gitCommit?: string | null }
    readonly environment?: { readonly runner?: string }
    readonly versions?: Readonly<Record<string, unknown>>
  }
  readonly results?: Readonly<
    Record<string, { readonly tiers?: Readonly<Record<string, RawTierEntry>> }>
  >
}

export interface CollectedEntry {
  readonly name: string
  readonly tier: string
  readonly entry: RawTierEntry
}

export interface NormalizedMeasurement {
  readonly medianMs: number
  readonly inputs?: Readonly<Record<string, unknown>>
}

export type NormalizedMeasurements = Record<string, Record<string, NormalizedMeasurement>>

export interface HistoryEntry {
  readonly timestamp?: string
  readonly gitCommit?: string | null
  readonly runner?: string
  readonly versions?: Readonly<Record<string, unknown>>
  readonly measurements?: Readonly<Record<string, Record<string, NormalizedMeasurement>>>
}

export interface HistoryFile {
  readonly historySchemaVersion?: number
  readonly entries?: readonly HistoryEntry[]
}

export function primaryMedianMs(entry: RawTierEntry | undefined): number | undefined

export function tryReadJson<T = unknown>(filePath: string | undefined): T | null

export function readJson<T = unknown>(filePath: string): T

export function collectEntries(results: RawResultsJson | null | undefined): CollectedEntry[]

export function resultsToMeasurements(
  results: RawResultsJson | null | undefined,
): NormalizedMeasurements

export function latestHistoryEntry(
  history: HistoryFile | null | undefined,
): HistoryEntry | undefined
