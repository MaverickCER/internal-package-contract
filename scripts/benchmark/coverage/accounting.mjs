// How a benchmark says what it did with one parameter (or key) of a function it exercises. Every parameter has
// one of these, so a reader can see that none was forgotten and why a fixed one was fixed.
//
//   swept              the suite's own unit is this parameter: it is what the size ladder varies
//   sweep:<variable>   one of the function's `sweeps` varies this parameter
//   variant:<name>     one of the function's `variants` measures this parameter's alternatives
//   fixed: <why>       held at one value on purpose, and the reason
//   not covered: <why> not measured, and the reason

/** The shortest reason that says anything. */
export const MIN_REASON = 10

/**
 * @param {unknown} value - an accounting as written.
 * @returns {{ kind: "swept" } | { kind: "sweep" | "variant", name: string } | { kind: "fixed" | "not covered", reason: string } | undefined}
 *   what it says, or `undefined` when it is not one of the forms.
 */
export function parseAccounting(value) {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (text === "swept") return { kind: "swept" }
  const reference = /^(sweep|variant):\s*(\S+)$/.exec(text)
  if (reference !== null) return { kind: reference[1], name: reference[2] }
  const reasoned = /^(fixed|not covered):\s*([\s\S]*)/.exec(text)
  // The text is already trimmed, so the reason's own end is the text's.
  if (reasoned !== null && reasoned[2].length >= MIN_REASON) {
    return { kind: reasoned[1], reason: reasoned[2] }
  }
  return undefined
}
