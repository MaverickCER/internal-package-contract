// What it takes for an exception record to count as accepted, shared by every registry that is judged in
// plain JavaScript (the benchmark gate runs in a workflow, outside the contract engine).

/** The structured fields every accepted record must have written, as for every other registry. */
export const REQUIRED_FIELDS = [
  "justification",
  "ruleBroken",
  "attempted",
  "constraint",
  "whyPreferable",
  "residualRisk",
  "revisitWhen",
]

/**
 * What is missing for a record to count as an accepted exception; empty means it is complete and unexpired.
 * @param {Record<string, unknown>} record
 * @param {Date} now
 * @returns {string[]}
 */
export function missingFields(record, now) {
  const missing = REQUIRED_FIELDS.filter((key) => {
    const value = record[key]
    return typeof value !== "string" || value.trim() === ""
  })
  const expires = record.expires
  if (/^\d{4}-\d{2}-\d{2}$/.test(expires) && expires < now.toISOString().slice(0, 10)) {
    missing.push(`expires (${expires} has passed)`)
  }
  return missing
}
