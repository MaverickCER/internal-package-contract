export function inline(text: string): string
export function slugOf(name: string): string
export function renderIndex(
  site: Record<string, unknown>,
  pkg: { name: string; version: string; license?: string },
): string
export function renderBrief(
  site: Record<string, unknown>,
  pkg: { name: string; version: string; license?: string },
): string
