export function bumpFor(
  subject: string,
  body: string,
  context?: { author?: string; preOne?: boolean },
): "patch" | "minor" | "major" | null
export function isPreOne(version: string): boolean
export function generateChangesets(
  cwd?: string,
  log?: (line: string) => void,
): { generated: number; files: string[] }
