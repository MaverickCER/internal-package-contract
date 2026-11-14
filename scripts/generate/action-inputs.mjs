// The "action-inputs" region: the inputs of the package's root `action.yml`, so a guide never restates them
// by hand. One row per input, in the file's order: the name, whether it is required, its default, and the
// first sentence of its description (the rest stays in `action.yml`). A missing or unreadable `action.yml`, or
// one with no inputs, stops generation.

import { parse } from "yaml"
import { toTable } from "./entry-points.mjs"

/**
 * @param {string} description - an input's description, possibly several sentences on several lines.
 * @returns {string} its first sentence on one line.
 * @internal Exported for direct unit coverage.
 */
export function firstSentence(description) {
  const flat = description.replace(/\s+/g, " ").trim()
  // A mark at the very end is the whole text, which the no-match branch returns already.
  const end = /[.!?](?=\s)/.exec(flat)
  return end === null ? flat : flat.slice(0, end.index + 1)
}

/**
 * @param {string | undefined} text - the content of `action.yml`, or `undefined` when there is none.
 * @returns {{ problems: string[], markdown: string }} the region's body, or what stops it being written.
 */
export function actionInputsRegion(text) {
  const rows = [["Input", "Required", "Default", "What it does"]]
  if (text === undefined) {
    return {
      problems: ['action.yml not found; the "action-inputs" region lists its inputs.'],
      markdown: toTable(rows),
    }
  }
  let inputs
  try {
    inputs = /** @type {{ inputs?: unknown } | null} */ (parse(text))?.inputs
  } catch {
    return { problems: ["action.yml is not valid YAML."], markdown: toTable(rows) }
  }
  if (inputs === null || typeof inputs !== "object" || Object.keys(inputs).length === 0) {
    return {
      problems: ['action.yml declares no inputs for the "action-inputs" region.'],
      markdown: toTable(rows),
    }
  }
  for (const [name, raw] of Object.entries(inputs)) {
    const input =
      /** @type {{ required?: unknown, default?: unknown, description?: unknown } | null} */ (
        raw
      ) ?? {}
    const fallback =
      input.default === undefined || input.default === "" ? "none" : `\`${String(input.default)}\``
    rows.push([
      `\`${name}\``,
      input.required === true ? "yes" : "no",
      fallback,
      typeof input.description === "string" ? firstSentence(input.description) : "",
    ])
  }
  return { problems: [], markdown: toTable(rows) }
}
