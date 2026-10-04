// Hand-authored type declarations for render-page.mjs -- see
// ./classify-complexity.d.mts's own doc comment for why these exist.

export interface BuildPageModelOptions {
  readonly histories: readonly string[]
  readonly maxEntries: number
  readonly readme?: string | undefined
  readonly repo?: string | undefined
}

export interface PageModelGroup {
  readonly group: string
  readonly series: ReadonlyArray<{
    readonly tier: string
    readonly points: ReadonlyArray<{ readonly index: number; readonly medianMs: number } | null>
  }>
  readonly complexityClass: string | null
  readonly exponent?: number | null
  readonly points?: number
  readonly reason?: string
  readonly rSquared?: number
}

export interface PageRun {
  readonly timestamp: string | null
  readonly commit: string | null
  readonly pullRequest: number | null
  readonly version: string | null
}

export interface PageModelCategory {
  readonly label: string
  readonly tierOrder: readonly string[]
  readonly entryCount: number
  readonly totalEntryCount: number
  readonly timestamps: ReadonlyArray<string | null>
  readonly runs: readonly PageRun[]
  readonly groups: readonly PageModelGroup[]
}

export interface PageModel {
  readonly readmeUrl?: string | undefined
  readonly repoUrl?: string | undefined
  readonly generatedAt: string
  readonly maxEntries: number
  readonly categories: readonly PageModelCategory[]
}

export function buildPageModel(options: BuildPageModelOptions): Promise<PageModel>

export function escapeHtml(value: unknown): string
export function formatMs(ms: number): string
export function describeGroup(group: PageModelGroup, runs: readonly PageRun[]): string
export function renderChartSvg(
  group: PageModelGroup,
  tierOrder: readonly string[],
  tierColorIndex: Readonly<Record<string, number>>,
  runs: readonly PageRun[],
  idPrefix: string,
): string
export function renderDataTable(
  group: PageModelGroup,
  tierOrder: readonly string[],
  runs: readonly PageRun[],
  repoUrl?: string,
): string
export function renderHtml(model: PageModel): string
