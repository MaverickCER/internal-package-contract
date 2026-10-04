// Pure algorithm: infers an algorithmic-complexity CLASS ("constant" through
// "cubic-or-worse") from a named benchmark's per-tier {medianMs, inputs}
// measurements, and diffs two such classifications to flag a "complexity
// shift" -- the headline signal this whole feature exists for (see
// render-summary.mjs / render-page.mjs, which are the only consumers of this
// module; it has no CLI of its own).
//
// No dependency on any consumer's tier-naming convention (env-cap's
// baseline/stress/extreme/enterprise, data-cap's baseline/stress/extreme, or
// any future renaming): a tier's "size" is always the sum of its own
// `inputs` object's numeric values (see `inputTotal`), never a hardcoded tier
// name or position.
//
// ## The algorithm
//
// For N >= 2 usable tiers (real `inputs`, positive size, positive medianMs),
// fit a least-squares line through (ln(size), ln(medianMs)) across ALL of
// them. Its slope `p` is the effective exponent of `medianMs ~ size^p` --
// the standard log-log-slope estimator for the exponent of a power law, and
// the natural generalization of "the ratio of medianMs growth against
// input-size growth between consecutive tiers" (the brief's own phrasing) to
// more than two points: for exactly N=2 tiers this reduces algebraically to
// the single pairwise ratio `ln(T2/T1) / ln(N2/N1)`; for N>=3 it's the
// consensus slope across every consecutive gap at once, weighted by how much
// size each gap actually spans, which is more robust to one noisy tier than
// eyeballing pairwise ratios independently would be.
//
// `p` is then snapped to the nearest of six fixed "canonical" exponents, one
// per complexity class (see CLASS_ANCHORS below) -- nearest-anchor
// classification, ties broken toward the lower/simpler class (see
// `snapExponentToClass`).
//
// ## Known limitations (see also each one's own dedicated unit test)
//
// - **constant vs logarithmic is the weakest distinction of the six.**
//   log(n) grows so slowly that its effective exponent over any *bounded*
//   size ratio (e.g. a 10x tier ladder) is small and gets smaller still as
//   the absolute tier sizes grow -- there is no fixed exponent threshold
//   that cleanly separates "truly flat" from "truly logarithmic" for every
//   possible tier ladder. What keeps this useful anyway: the SAME tier
//   ladder (same sizes, same thresholds) is reused for both the historical
//   and the current classification of a given group, so whatever bias the
//   boundary has is applied identically both times -- a genuine algorithmic
//   change (say linear regressing to quadratic) moves `p` by roughly a full
//   canonical gap (~1.0), far more than the constant/logarithmic ambiguity
//   band (~0.3), so real shifts still clear the noise floor. Treat a
//   constant<->logarithmic shift specifically as lower-confidence than any
//   other transition.
// - **linear vs linearithmic is similarly close** (n*log(n)'s effective
//   exponent over realistic tier ratios sits only ~0.15-0.3 above linear's
//   exact 1.0) -- same mitigation applies (see CLASS_ANCHORS' own comment).
// - Needs >= 2 usable tiers; a tier missing `inputs`, with non-numeric/
//   non-finite input values, with a non-positive size, or with a
//   non-positive medianMs is EXCLUDED from the series, not fatal -- classify
//   returns `{ complexityClass: null, reason: "insufficient-data" }` once
//   fewer than 2 tiers survive that filter.
// - If every surviving tier has the SAME size (no real size variation to
//   measure a slope against), classification is impossible for a different
//   reason -- `{ complexityClass: null, reason: "no-size-variation" }`.
// - A shift can only be flagged when BOTH the current and the comparison
//   (history) classification succeeded; compared against only pre-v2 history
//   (no `inputs` recorded at all) or a group appearing for the first time,
//   `detectComplexityShift` reports `shifted: false` -- there is nothing to
//   diff against, not a claim that nothing changed.

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
 * value for typical benchmark tier ratios (5x-20x) -- see the module
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
 * Sum of every finite numeric value in an `inputs` object -- deliberately
 * generic over its keys (never `inputs.variables` or `inputs.itemCount`
 * specifically), per data-cap's own "two independent axes" design: whatever
 * axis a given group actually varies along, its total is still a single
 * comparable scalar this way. Returns `undefined` for a missing/non-object
 * `inputs`, or one with no finite-numeric values at all.
 */
export function inputTotal(inputs) {
  if (!inputs || typeof inputs !== "object") return undefined
  const values = Object.values(inputs).filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  )
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0)
}

/**
 * Builds a size-ordered series from a group's `{ tierName: { medianMs,
 * inputs? } }` measurements (the shape shared by a normalized results.json
 * -- see lib/results.mjs's `resultsToMeasurements` -- and a history entry's
 * own `measurements[group]`). Excludes any tier lacking a usable `inputs`
 * total, a positive size, or a positive finite `medianMs` -- see the module
 * comment's "insufficient-data" / "no-size-variation" limitations for what
 * happens once too few points remain.
 */
export function buildSizeSeries(tiers) {
  const points = []
  for (const [tier, measurement] of Object.entries(tiers ?? {})) {
    const size = inputTotal(measurement?.inputs)
    const medianMs = measurement?.medianMs
    if (size === undefined || !(size > 0)) continue
    if (typeof medianMs !== "number" || !Number.isFinite(medianMs) || !(medianMs > 0)) continue
    points.push({ tier, size, medianMs })
  }
  points.sort((a, b) => a.size - b.size)
  return points
}

/**
 * Least-squares slope of ln(medianMs) against ln(size) across `series`
 * (already filtered to positive size/medianMs by `buildSizeSeries`). Returns
 * `null` when fewer than 2 points are given, or when every point shares the
 * same size (zero variance on the x-axis -- the slope is undefined, not
 * infinite or zero). For exactly 2 points this is algebraically identical to
 * the single pairwise ratio `ln(T2/T1) / ln(N2/N1)`.
 */
export function estimateGrowthExponent(series) {
  if (!Array.isArray(series) || series.length < 2) return null

  const xs = series.map((point) => Math.log(point.size))
  const ys = series.map((point) => Math.log(point.medianMs))
  const n = xs.length
  const xMean = xs.reduce((a, b) => a + b, 0) / n
  const yMean = ys.reduce((a, b) => a + b, 0) / n

  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean
    numerator += dx * (ys[i] - yMean)
    denominator += dx * dx
  }

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
 * A ratio between the slowest and fastest tier below which the group is simply flat: with that little
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
  const window = series.length > FIT_WINDOW ? series.slice(series.length - FIT_WINDOW) : series
  const exponent = estimateGrowthExponent(window)
  if (exponent === null) return null
  const xs = window.map((point) => Math.log(point.size))
  const ys = window.map((point) => Math.log(point.medianMs))
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length
  const intercept = yMean - exponent * xMean
  let residual = 0
  let total = 0
  for (let i = 0; i < xs.length; i++) {
    residual += (ys[i] - (intercept + exponent * xs[i])) ** 2
    total += (ys[i] - yMean) ** 2
  }
  const rSquared = total === 0 ? 1 : 1 - residual / total
  const times = window.map((point) => point.medianMs)
  const flat = Math.max(...times) / Math.min(...times) < FLAT_RATIO
  return { exponent, rSquared, flat, points: window.length }
}

/**
 * Nearest-anchor snap of a growth exponent to one of COMPLEXITY_CLASSES.
 * CLASS_ANCHORS is ascending, and ties are broken toward the FIRST (lower,
 * simpler) anchor found at the minimum distance -- an exact midpoint between
 * two classes snaps to the cheaper one, so this classifier is conservative
 * about alarming a caller with a scarier label than the data strictly
 * supports (a strict `<` comparison below, not `<=`, is what keeps the
 * earlier/lower anchor as the incumbent on a tie).
 */
export function snapExponentToClass(exponent) {
  let best = CLASS_ANCHORS[0]
  let bestDistance = Math.abs(exponent - best.exponent)
  for (const anchor of CLASS_ANCHORS.slice(1)) {
    const distance = Math.abs(exponent - anchor.exponent)
    if (distance < bestDistance) {
      best = anchor
      bestDistance = distance
    }
  }
  return best.complexityClass
}

/**
 * Full classification of one group's tier measurements: builds the series,
 * estimates the exponent, and snaps it to a class. `points` in the result is
 * how many tiers actually survived filtering -- useful for a caller that
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
    }
  }

  const fit = fitGrowth(series)
  if (fit === null) {
    return {
      complexityClass: null,
      exponent: null,
      points: series.length,
      reason: "no-size-variation",
    }
  }

  // A group that barely moves is flat, whatever its R-squared; one that moves but not along a power
  // law (a step, a cache cliff) is not given a class the data does not support.
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
 * Diffs a group's previous (history) vs current (fresh run) tier
 * measurements. `shifted` is true only when BOTH classifications succeeded
 * AND they disagree -- see the module comment's "known limitations" for why
 * a `null` on either side never counts as a shift.
 */
export function detectComplexityShift(previousTiers, currentTiers) {
  const previous = classifyGroup(previousTiers ?? {})
  const current = classifyGroup(currentTiers ?? {})
  return {
    shifted:
      previous.complexityClass !== null &&
      current.complexityClass !== null &&
      previous.complexityClass !== current.complexityClass,
    previousClass: previous.complexityClass,
    currentClass: current.complexityClass,
    previousExponent: previous.exponent,
    currentExponent: current.exponent,
  }
}
