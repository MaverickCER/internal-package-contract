export interface Verdict {
  outcome: string
  rationale: string
}
export interface ComparisonRow {
  id: string
  before: string
  after: string
  status: "same" | "reworded" | "allowed" | "changed"
  reason?: string
  rationale?: string
}
export interface AllowedDifference {
  ids: readonly string[] | "*"
  from: string
  to: string
  rationale?: RegExp
  reason: string
}
export const ALLOWED_DIFFERENCES: readonly AllowedDifference[]
export function compareVerdicts(
  before: Map<string, Verdict>,
  after: Map<string, Verdict>,
): ComparisonRow[]
export function renderComparison(rows: readonly ComparisonRow[]): string
