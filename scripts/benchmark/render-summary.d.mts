// Hand-authored type declarations for render-summary.mjs -- see
// ./classify-complexity.d.mts's own doc comment for why these exist.

export interface RenderSummaryOptions {
  readonly examples: readonly string[]
  readonly budgetsPath?: string
  readonly marker?: string
}

export function renderSummary(options: RenderSummaryOptions): Promise<string>

export interface GateFailure {
  readonly level: "fail"
  readonly kind: string
  readonly message: string
  readonly label: string
}

export function summarize(
  options: RenderSummaryOptions,
): Promise<{ markdown: string; failures: GateFailure[] }>
