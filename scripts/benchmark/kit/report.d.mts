export function formatMs(ms: number): string
export function formatBytes(bytes: number): string
export function orderOfMagnitudeUsd(a: number, b: number): string
export function renderReport(
  results: object,
  suite: object,
  options?: { docsPath?: string },
): string
