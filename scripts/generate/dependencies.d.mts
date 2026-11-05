export function dependencyRegion(
  pkg: {
    name: string
    dependencies?: unknown
    peerDependencies?: unknown
    peerDependenciesMeta?: unknown
  },
  surface: unknown,
): { problems: string[]; markdown: string }
