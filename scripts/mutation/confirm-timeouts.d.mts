export interface Mutant {
  status?: string
  mutatorName?: string
  replacement?: string
  statusReason?: string
  location: { start: { line: number; column: number }; end: { line: number } }
}
export interface Report {
  files: Record<string, { mutants: Mutant[] }>
}
export const MAXIMUM_CONFIRMED: number
export const REASON: string
export function timedOut(report: Report): { file: string; mutant: Mutant }[]
export function same(mutant: Mutant, other: Mutant): boolean
export function confirmTimeouts(
  report: Report,
  rerun: (file: string, from: number, to: number) => Report | undefined,
): { confirmed: number; caught: number }
export function strykerRerun(
  cwd: string,
  common: string[],
  evidence: string,
  spawn?: (command: string, args: string[], options: { cwd: string; stdio: "ignore" }) => unknown,
): (file: string, from: number, to: number) => Report | undefined
export function confirmEvidence(
  evidence: string,
  rerun: (file: string, from: number, to: number) => Report | undefined,
): { confirmed: number; caught: number }
