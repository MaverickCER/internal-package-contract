// Turns measured time and memory into an ESTIMATED price, because the question a platform engineer or
// CTO actually asks is "what does this cost me", not "how many microseconds".
//
// Two deliberately different pricing shapes bracket the answer:
//   low  -- CPU-priced compute (a container / VM billed per vCPU-hour): you pay for CPU seconds.
//   high -- duration-and-memory-priced compute (functions-as-a-service billed per GB-second): you pay
//           for wall seconds multiplied by the memory the platform reserves (never less than its minimum).
// The rates below are published list prices rounded for the model; they are ASSUMPTIONS, change with
// time and region, and are overridable through `benchmark.config.json` -> `costRates`. Every dollar
// figure in a report is labelled an estimate for exactly that reason.

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
    opsPerSecondPerCore: operation.wallMs > 0 ? 1000 / operation.wallMs : Number.POSITIVE_INFINITY,
  }
}

/**
 * @param {number} usd - a dollar amount.
 * @returns {string} a compact dollar string that stays readable down to hundredths of a cent.
 */
export function formatUsd(usd) {
  if (!Number.isFinite(usd)) return "n/a"
  if (usd === 0) return "$0"
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toLocaleString("en-US", { maximumSignificantDigits: 2, maximumFractionDigits: 12 })}`
}
