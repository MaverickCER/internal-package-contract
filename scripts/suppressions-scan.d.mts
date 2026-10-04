import type * as TypeScript from "typescript"

export const DOMAINS: readonly string[]
export const MIN_REASON_LENGTH: number
export const MIN_BLOCK_REASON_LENGTH: number
export interface Suppression {
  id: string
  domain: string
  rule: string
  directive: string
  file: string
  line: number
  reason: string
  blockReason: string
  blanket: boolean
  documented: boolean
  closing: boolean
}
export interface ParsedDirective {
  domain: string
  directive: string
  rules: string[]
  reason: string
  blanket: boolean
  closing: boolean
}
export function parseDirective(body: string, kind: "line" | "block"): ParsedDirective[]
export function scanSource(file: string, text: string, ts: typeof TypeScript): Suppression[]
export function scanMarkdown(file: string, text: string): Suppression[]
export function listScannableFiles(cwd: string): string[]
export function scanRepository(
  cwd: string,
  tsOverride?: typeof TypeScript,
): { files: number; suppressions: Suppression[] }
