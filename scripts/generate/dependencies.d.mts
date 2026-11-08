export function dependencyRegion(
  pkg: {
    name: string
    dependencies?: unknown
    optionalDependencies?: unknown
    peerDependencies?: unknown
    peerDependenciesMeta?: unknown
  },
  surface: unknown,
): { problems: string[]; markdown: string }
