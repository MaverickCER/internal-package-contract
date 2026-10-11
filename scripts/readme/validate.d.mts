export const REQUIRED_SECTIONS: readonly string[]
export const MAX_LINES: number
export const REQUIRED_BADGES: readonly { label: string; pattern: RegExp }[]
export function validateReadme(markdown: string): string[]
