export interface TrendRow {
  name: string
  variable: string
  bigO: string
  trend: string
}
export function describeGroup(group: string, variable?: string): { name: string; variable: string }
export function trendOf(
  now: { class?: string | null; notation?: string | null } | undefined,
  before: { class?: string | null; notation?: string | null } | undefined,
  hadPrevious: boolean,
): string
export function trendRows(
  current: object | null | undefined,
  previous: object | null | undefined,
): TrendRow[]
export function renderTrendTable(rows: TrendRow[]): string[]
