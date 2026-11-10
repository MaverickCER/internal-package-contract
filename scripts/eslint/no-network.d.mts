import type { Rule } from "eslint"

export const NETWORK_MODULES: readonly string[]
export const NETWORK_GLOBALS: readonly string[]
export function moduleOf(specifier: string): string
export const noNetwork: Rule.RuleModule
