export const STANDARD: string
export const NOT_RUN: string[]
export interface Outcome {
  outcome: string
  rationale: string
}
export interface Regression {
  id: string
  from: string
  to: string
  rationale: string
}
export function outcomesOf(file: string): Map<string, Outcome>
export function compare(
  before: Map<string, Outcome>,
  after: Map<string, Outcome>,
): { regressions: Regression[]; improvements: string[] }
export function satisfies(version: string, range: string): boolean
export function nestedDependencies(
  standard: string,
  consumer: string,
): { name: string; wanted: string; installed: string | undefined }[]
export function workspaceOf(input: { consumer: string; standard: string | undefined }): string
export function runContract(
  work: string,
  skip: string[],
): { report: string | undefined; status: number | null }
export function verifyConsumer(input: {
  consumer: string
  standard: string
  skip: string[]
  keep: boolean
  io: { out: (text: string) => void }
}): { regressions: Regression[]; problem?: string }
export function run(
  argv: string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): number
