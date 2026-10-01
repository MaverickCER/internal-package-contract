// Hand-authored type declarations for render-page.mjs -- see
// ./classify-complexity.d.mts's own doc comment for why these exist.

export interface BuildPageModelOptions {
  readonly histories: readonly string[]
  readonly maxEntries: number
  readonly readme?: string | undefined
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
}

export interface PageModelCategory {
  readonly label: string
  readonly tierOrder: readonly string[]
  readonly entryCount: number
  readonly totalEntryCount: number
  readonly timestamps: ReadonlyArray<string | null>
  readonly groups: readonly PageModelGroup[]
}

export interface PageModel {
  readonly readmeUrl?: string | undefined
  readonly generatedAt: string
  readonly maxEntries: number
  readonly categories: readonly PageModelCategory[]
}

export function buildPageModel(options: BuildPageModelOptions): Promise<PageModel>
