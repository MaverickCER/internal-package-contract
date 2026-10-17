import type { Gain } from "./complexity-gain.mjs"
export interface UndeterminedGroup {
  suite: string
  group: string
  variable?: string
  reason: string
}
export function undeterminedGroups(cwd: string, suites: string[]): UndeterminedGroup[]
export function scanComplexity(cwd: string): {
  state: "none" | "no-baseline" | "compared"
  tag: string | null
  suites: string[]
  gains: Gain[]
  undetermined: UndeterminedGroup[]
}
