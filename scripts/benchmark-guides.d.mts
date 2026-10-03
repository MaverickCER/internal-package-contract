export const GUIDES: readonly string[]
export const CANONICAL_DIR: string
export function compareGuides(
  cwd: string,
  canonicalDir?: string,
): { applicable: boolean; missing: string[]; differing: string[] }
export function syncGuides(cwd: string, canonicalDir?: string): string[]
