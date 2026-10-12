export function isCi(env: Readonly<Record<string, string | undefined>>): boolean
export function hooksStatus(input: {
  ci: boolean
  inRepo: boolean
  configured: string | undefined
  bundled: string
  realpath: (path: string) => string
}): "ci" | "not-a-repo" | "installed" | "missing"
