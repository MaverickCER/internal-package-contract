export function standardsRegion(
  surface: unknown,
  exists: (file: string) => boolean,
): { problems: string[]; markdown: string }
