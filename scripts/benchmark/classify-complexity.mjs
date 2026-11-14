// How a benchmark group's growth class (big-O) is fitted from its measurements, and when two fits count as a
// shift. Used by the kit's analysis, the gates, the complexity-gain check, and the summary and page renderers.
//
// A tier's size is the sum of its `inputs` numeric values, never a tier name or position. A tier without a
// positive size or a positive `medianMs` is left out, with the reason recorded (`discardedTiers`). Fewer than
// two usable tiers gives `reason: "insufficient-data"`; all at one size gives `"no-size-variation"`.
//
// The exponent `p` of `medianMs ~ size^p` is the least-squares slope of ln(medianMs) against ln(size). It is
// fitted on the largest `FIT_WINDOW` sizes only: a fixed per-call overhead dominates the small end and would
// report a linear function as logarithmic. A fit whose R-squared is below `MIN_R_SQUARED` gets no class
// (`reason: "poor-fit"`). A group whose timings barely move is flat and keeps its class whatever the fit.
// `p` is then snapped to the nearest class anchor; a tie goes to the cheaper class.
//
// A shift (`detectComplexityShift`) needs three things. Both fits have a class, the classes differ, and the
// exponents are at least `SHIFT_MARGIN` apart. A label that flips at a boundary on noise alone is not a shift.
// A group with no previous fit reports no shift, which is not a claim that nothing changed.
//
// Known limit: constant against logarithmic, and linear against linearithmic, are the closest anchors. They
// are the least reliable to tell apart on a bounded ladder. The kit's `agreement` calls neighbouring classes
// "close" for that reason, and only two or more classes apart fails the complexity gate.

/** In size order, cheapest ("constant") to worst ("cubic-or-worse"). */
export const COMPLEXITY_CLASSES = Object.freeze([
  "constant",
  "logarithmic",
  "linear",
  "linearithmic",
  "quadratic",
  "cubic-or-worse",
])

/**
 * The exponent `p` such that `medianMs ~ size^p` a "clean" example of each
 * class would produce. `linearithmic`'s 1.2 (rather than n*log(n)'s
 * theoretical non-power-law shape) is a deliberately chosen representative
 * value for typical benchmark tier ratios (5x-20x): see the module
 * comment's "linear vs linearithmic" limitation. `cubic-or-worse`'s 3
 * is an anchor, not a ceiling: nearest-anchor classification means anything
 * with `p` past the quadratic/cubic midpoint (2.5) snaps here
 * regardless of how much higher it actually is.
 */
const CLASS_ANCHORS = Object.freeze([
  { complexityClass: "constant", exponent: 0 },
  { complexityClass: "logarithmic", exponent: 0.3 },
  { complexityClass: "linear", exponent: 1 },
  { complexityClass: "linearithmic", exponent: 1.2 },
  { complexityClass: "quadratic", exponent: 2 },
  { complexityClass: "cubic-or-worse", exponent: 3 },
])

/**
 * Sum of every finite numeric value in an `inputs` object. It is deliberately
 * generic over its keys (never `inputs.variables` or `inputs.itemCount`
 * specifically), per data-cap's own "two independent axes" design. Whatever
 * axis a given group actually varies along, its total is still a single
 * comparable scalar this way. Returns `undefined` for a missing/non-object
 * `inputs`, or one with no finite-numeric values at all.
 */
export function inputTotal(inputs) {
  if (!inputs) return undefined
  // `Number.isFinite` is false for anything that is not a finite number, strings included.
  const values = Object.values(inputs).filter((value) => Number.isFinite(value))
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0)
}

/**
 * Builds a size-ordered series from a group's `{ tierName: { medianMs,
 * inputs? } }` measurements (the shape shared by a normalized results.json:
 * see lib/results.mjs's `resultsToMeasurements`; and a history entry's
 * own `measurements[group]`). Excludes any tier lacking a usable `inputs`
 * total, a positive size, or a positive finite `medianMs`: see the module
 * comment's "insufficient-data" / "no-size-variation" limitations for what
 * happens once too few points remain.
 */
export function buildSizeSeries(tiers) {
  const points = []
  for (const [tier, measurement] of Object.entries(tiers ?? {})) {
    const size = inputTotal(measurement?.inputs)
    const medianMs = measurement?.medianMs
    if (!(size > 0)) continue
    if (!Number.isFinite(medianMs) || !(medianMs > 0)) continue
    points.push({ tier, size, medianMs })
  }
  points.sort((a, b) => a.size - b.size)
  return points
}

/**
 * Why each tier that {@link buildSizeSeries} leaves out was left out, so a group whose big-O could not be
 * determined can say what to fix.
 * @param {Record<string, { medianMs?: number, inputs?: Record<string, unknown> }> | undefined} tiers - the same measurements.
 * @returns {{ tier: string, why: string }[]} one entry per unusable tier, in the order given.
 */
export function discardedTiers(tiers) {
  const discarded = []
  for (const [tier, measurement] of Object.entries(tiers ?? {})) {
    if (!(inputTotal(measurement?.inputs) > 0)) {
      discarded.push({ tier, why: "it recorded no size" })
    } else if (!(Number.isFinite(measurement.medianMs) && measurement.medianMs > 0)) {
      discarded.push({ tier, why: "its time was zero, below the timer's resolution" })
    }
  }
  return discarded
}

/**
 * Least-squares slope of ln(medianMs) against ln(size) across `series`
 * (already filtered to positive size/medianMs by `buildSizeSeries`). Returns
 * `null` when fewer than 2 points are given, or when every point shares the
 * same size (zero variance on the x-axis: the slope is undefined, not
 * infinite or zero). For exactly 2 points this is algebraically identical to
 * the single pairwise ratio `ln(T2/T1) / ln(N2/N1)`.
 */
export function estimateGrowthExponent(series) {
  if (!Array.isArray(series)) return null

  const xs = series.map((point) => Math.log(point.size))
  const ys = series.map((point) => Math.log(point.medianMs))
  const n = xs.length
  const xMean = xs.reduce((a, b) => a + b, 0) / n
  const yMean = ys.reduce((a, b) => a + b, 0) / n

  // Fewer than two points, or every point at one size, leaves no x-axis variance to fit a slope to.
  // The y deviations sum to zero, so weighting them by x gives the same covariance as by x - xMean.
  const numerator = xs.reduce((sum, x, i) => sum + x * (ys[i] - yMean), 0)
  const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0)

  if (denominator === 0) return null
  return numerator / denominator
}

/**
 * How many of the LARGEST sizes the exponent is fitted on once a ladder is longer than this. A real
 * cost is `fixed overhead + work(n)`; a single power law fitted across every size is dominated by the
 * fixed per-call overhead at the small end and reports a function that is linear for large inputs as
 * "logarithmic". The large end is where the algorithm shows, so that is what is fitted.
 */
export const FIT_WINDOW = 5

/** The lowest R-squared of the log-log fit that still counts as a measurement of a growth rate. */
export const MIN_R_SQUARED = 0.8

/**
 * A ratio between the slowest and fastest tier below which the group is flat. With that little
 * movement, noise rather than growth dominates the fit and R-squared is meaningless.
 */
const FLAT_RATIO = 1.5

/**
 * Fits the growth exponent on the largest {@link FIT_WINDOW} sizes of `series` (all of them when the
 * ladder is not longer), and says how well a power law describes them.
 * @param {readonly { size: number, medianMs: number }[]} series - ascending by size, positive values.
 * @returns {{ exponent: number, rSquared: number, flat: boolean, points: number } | null} `null` when no slope exists.
 */
export function fitGrowth(series) {
  const window = series.slice(-FIT_WINDOW)
  const exponent = estimateGrowthExponent(window)
  if (exponent === null) return null
  const xs = window.map((point) => Math.log(point.size))
  const ys = window.map((point) => Math.log(point.medianMs))
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length
  const intercept = yMean - exponent * xMean
  const residual = xs.reduce((sum, x, i) => sum + (ys[i] - (intercept + exponent * x)) ** 2, 0)
  const total = ys.reduce((sum, y) => sum + (y - yMean) ** 2, 0)
  const rSquared = total === 0 ? 1 : 1 - residual / total
  const times = window.map((point) => point.medianMs)
  const flat = Math.max(...times) / Math.min(...times) < FLAT_RATIO
  return { exponent, rSquared, flat, points: window.length }
}

/**
 * Nearest-anchor snap of a growth exponent to one of COMPLEXITY_CLASSES.
 * CLASS_ANCHORS is ascending, and ties are broken toward the FIRST (lower,
 * simpler) anchor found at the minimum distance. An exact midpoint between
 * two classes snaps to the cheaper one, so this classifier is conservative
 * about alarming a caller with a scarier label than the data strictly
 * supports. A strict `<` comparison below, not `<=`, is what keeps the
 * earlier/lower anchor as the incumbent on a tie.
 */
export function snapExponentToClass(exponent) {
  const distance = (anchor) => Math.abs(exponent - anchor.exponent)
  return CLASS_ANCHORS.reduce((best, anchor) => (distance(anchor) < distance(best) ? anchor : best))
    .complexityClass
}

/**
 * Full classification of one group's tier measurements: builds the series,
 * estimates the exponent, and snaps it to a class. `points` in the result is
 * how many tiers actually survived filtering: useful for a caller that
 * wants to show its confidence (2 points is the bare minimum; more is
 * better).
 */
export function classifyGroup(tiers) {
  const series = buildSizeSeries(tiers)
  if (series.length < 2) {
    return {
      complexityClass: null,
      exponent: null,
      points: series.length,
      reason: "insufficient-data",
      discarded: discardedTiers(tiers),
    }
  }

  const fit = fitGrowth(series)
  if (fit === null) {
    return {
      complexityClass: null,
      exponent: null,
      points: series.length,
      reason: "no-size-variation",
      size: series[0].size,
    }
  }

  // A group that barely moves is flat, whatever its R-squared; one that moves but not along a power
  // law (a step, a cache cliff) is not given a class the data does not support.
  // Stryker disable next-line EqualityOperator: an R-squared computed from logarithms of real timings is never exactly MIN_R_SQUARED, so `<` and `<=` cannot disagree
  if (!fit.flat && fit.rSquared < MIN_R_SQUARED) {
    return {
      complexityClass: null,
      exponent: fit.exponent,
      points: series.length,
      rSquared: fit.rSquared,
      reason: "poor-fit",
    }
  }

  return {
    complexityClass: snapExponentToClass(fit.exponent),
    exponent: fit.exponent,
    points: series.length,
    rSquared: fit.rSquared,
  }
}

/**
 * How far the fitted exponent must move, in addition to the class changing, before a shift is reported.
 * Classes are anchors on a line (0, 0.3, 1, 1.2, 2, 3). A group whose exponent sits near the midpoint
 * of two of them changes label on a shift of a few hundredths. Measured on real CI runs, an exponent of
 * 1.13 became 1.03 (`linearithmic` to `linear`) with nothing but run-to-run noise. A real change of
 * algorithm moves the exponent by about a whole class gap (linear to quadratic is ~1.0), so requiring 0.25
 * keeps those and drops the label flips that are only noise at a boundary.
 */
export const SHIFT_MARGIN = 0.25

/** Whether two fitted exponents are at least {@link SHIFT_MARGIN} apart (the boundary itself counts). */
export function movedByMargin(previousExponent, currentExponent) {
  return Math.abs(previousExponent - currentExponent) >= SHIFT_MARGIN
}

/**
 * Diffs a group's previous (history) vs current (fresh run) tier
 * measurements. `shifted` is true only when BOTH classifications succeeded
 * AND they disagree by at least {@link SHIFT_MARGIN} of exponent: see the module comment's "known limitations" for why
 * a `null` on either side never counts as a shift.
 */
export function detectComplexityShift(previousTiers, currentTiers) {
  const previous = classifyGroup(previousTiers ?? {})
  const current = classifyGroup(currentTiers ?? {})
  return {
    shifted:
      previous.complexityClass !== null &&
      current.complexityClass !== null &&
      previous.complexityClass !== current.complexityClass &&
      movedByMargin(previous.exponent, current.exponent),
    previousClass: previous.complexityClass,
    currentClass: current.complexityClass,
    previousExponent: previous.exponent,
    currentExponent: current.exponent,
  }
}
