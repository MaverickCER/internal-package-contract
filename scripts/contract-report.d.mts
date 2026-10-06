export const NOT_EVALUATED_ACCEPTED: "Not evaluated (accepted by"
export const NOT_EVALUATED_UNEXCEPTED: "Not evaluated (no exception recorded"
export type ResultClass = "pass" | "warn" | "not-evaluated" | "unexcepted" | "fail" | "skipped"
export interface PolicyResultLike {
  outcome: string
  rationale: string
}
export interface ContractReport {
  version: 1
  generatedAt: string
  strict: boolean
  passed: boolean
  counts: Record<ResultClass, number>
  totalDurationMs: number
  checks: {
    id: string
    outcome: string
    class: ResultClass
    rationale: string
    durationMs: number
  }[]
}
export function classifyResult(result: PolicyResultLike): ResultClass
export function mergeEvidence(
  documents: readonly { startedAt: string; completedAt: string; checks: Record<string, unknown> }[],
): {
  version: 1
  startedAt: string
  completedAt: string
  durationMs: number
  checks: Record<string, unknown>
}
export function buildReport(input: {
  results: Record<string, PolicyResultLike>
  evidenceChecks: Record<string, { durationMs: number }>
  skipped: readonly string[]
  strict: boolean
  generatedAt: string
}): ContractReport
export function renderMarkdown(report: ContractReport, options?: { title?: string }): string
export function writeReportFiles(
  dir: string,
  documents: { evidence: unknown; report: ContractReport; markdown: string },
): void
