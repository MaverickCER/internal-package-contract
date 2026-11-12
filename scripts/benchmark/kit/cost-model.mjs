// Turns measured time and memory into an estimated price. The question a reader asks of a benchmark is what
// it costs, not how many microseconds it takes.
//
// Two pricing shapes bracket the answer:
//   low  -- CPU-priced compute (a container or VM billed per vCPU-hour): CPU seconds are what is paid for.
//   high -- duration-and-memory-priced compute (functions billed per GB-second): wall seconds multiplied by
//           the memory the platform reserves, never less than its minimum.
// The default rates are published list prices rounded for the model. They are assumptions, change with time
// and region, and are overridable through `benchmark.config.json` -> `costRates`. Every dollar figure in a
// report is labelled an estimate for that reason.

/** Default, overridable rates (USD). */
export const DEFAULT_RATES = Object.freeze({
  vCpuHourUsd: 0.04048,
  gbSecondUsd: 0.0000166667,
  minMemoryMb: 128,
})

/**
 * @param {{ wallMs: number, cpuMs: number, heapBytes?: number }} operation - the median cost of ONE operation.
 * @param {Partial<typeof DEFAULT_RATES>} [rates] - overrides for DEFAULT_RATES.
 * @returns {{ lowUsdPerMillion: number, highUsdPerMillion: number, opsPerSecondPerCore: number }} estimated USD per one million operations, plus the single-core throughput ceiling.
 */
export function estimateCost(operation, rates = {}) {
  const { vCpuHourUsd, gbSecondUsd, minMemoryMb } = { ...DEFAULT_RATES, ...rates }
  const cpuSeconds = operation.cpuMs / 1000
  const wallSeconds = operation.wallMs / 1000
  const reservedGb = Math.max(minMemoryMb, (operation.heapBytes ?? 0) / (1024 * 1024)) / 1024
  return {
    lowUsdPerMillion: (cpuSeconds / 3600) * vCpuHourUsd * 1_000_000,
    highUsdPerMillion: wallSeconds * reservedGb * gbSecondUsd * 1_000_000,
    // A zero (or nonsensical negative) time is unbounded throughput, not a negative one.
    opsPerSecondPerCore: 1000 / Math.max(operation.wallMs, 0),
  }
}

/**
 * @param {number} usd - a dollar amount.
 * @returns {string} a compact dollar string that stays readable down to hundredths of a cent.
 */
export function formatUsd(usd) {
  if (!Number.isFinite(usd)) return "n/a"
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toLocaleString("en-US", { maximumSignificantDigits: 2, maximumFractionDigits: 12 })}`
}
