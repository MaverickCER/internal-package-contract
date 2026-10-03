export function bumpFor(
  subject: string,
  body: string,
  context?: { author?: string; preOne?: boolean },
): "patch" | "minor" | "major" | null
export function isPreOne(version: string): boolean
