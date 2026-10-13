import type { SkillFacts } from "./facts.mjs"
export const DEFAULT_BUDGET: number
export const MAXIMUM_BUDGET: number
export function shortName(name: string): string
export function skillFolder(name: string): string
export function wordsOf(text: string): number
export function cell(text: string): string
export function whole(text: string): string
export function linkTo(repository: string, file: string): string
export function rawLink(repository: string, name: string): string
export function renderSkill(
  facts: SkillFacts,
  example: { code: string; file: string; language: string } | undefined,
): string
export function renderApi(facts: SkillFacts): string
