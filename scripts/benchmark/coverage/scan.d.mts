import type { CoverageFinding } from "./findings.mjs"
export const API_CONTRACT_DIR: string
export function readApi(cwd: string): { targets: { model: object; declaration?: string }[] }
export function scanCoverage(cwd: string): {
  state: "no-api" | "no-coverage" | "checked"
  suites: string[]
  functions: number
  findings: CoverageFinding[]
  stale: string[]
}
