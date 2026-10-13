export interface Region {
  name: string
  start: number
  end: number
}
export function findRegions(text: string): {
  regions: Region[]
  problems: { line: number; message: string }[]
}
export function replaceRegions(
  text: string,
  regions: Region[],
  render: (name: string) => string,
): string
