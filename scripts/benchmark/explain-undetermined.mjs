// Says why a group's big-O could not be determined, in terms of what the run measured, so the person reading
// a warning knows what to change. Pure: it reads one `analysis.complexity` entry of a results.json.

/** @param {number} count @param {string} noun @returns {string} `1 size`, `3 sizes`. */
function counted(count, noun) {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * @param {{ reason?: string, points?: number, size?: number, rSquared?: number | null, exponent?: number | null, minRSquared?: number, discarded?: readonly { tier: string, why: string }[], unmeasured?: readonly { tier: string, status: string, message?: string }[], variable?: string }} value - one group's complexity entry.
 * @returns {string} the reason, as a sentence without a final full stop.
 */
export function explainUndetermined(value) {
  const unit = value.variable === undefined ? "size" : `${value.variable} size`
  switch (value.reason) {
    case "insufficient-data": {
      const lost = [
        ...(value.unmeasured ?? []).map(
          ({ tier, status, message }) =>
            `${tier} ${status}${message === undefined ? "" : ` (${message})`}`,
        ),
        ...(value.discarded ?? []).map(({ tier, why }) => `${tier} was unusable: ${why}`),
      ]
      return `only ${counted(value.points ?? 0, unit)} gave a usable measurement and a growth rate needs at least 2${lost.length === 0 ? "" : `; lost: ${lost.join("; ")}`}`
    }
    case "no-size-variation":
      return `every usable measurement is at the same ${unit} (${String(value.size)}), so there is no growth to measure`
    case "poor-fit":
      return `over the largest ${counted(value.points ?? 0, unit)} the timings do not follow one growth rate (R² ${value.rSquared?.toFixed(2) ?? "n/a"}, and a fit below ${String(value.minRSquared ?? 0.8)} is not trusted; fitted exponent ${value.exponent?.toFixed(2) ?? "n/a"}). The cost probably changes regime between sizes (a cache, a threshold, a batch size) or run-to-run noise outweighs the growth`
    default:
      return "the results record no reason (they were written before reasons were recorded); run the benchmark again to get one"
  }
}
