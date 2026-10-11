import type { Gain } from "./complexity-gain.mjs"
export function suiteDirectories(cwd: string): string[]
export function scanComplexity(cwd: string): {
  state: "none" | "no-baseline" | "compared"
  tag: string | null
  suites: string[]
  gains: Gain[]
}
