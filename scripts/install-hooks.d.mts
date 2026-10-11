export function hooksPathFor(input: { installed: boolean; packageHooks: string }): string
export function run(input: {
  inRepo: boolean
  installed: boolean
  packageHooks: string
  git: (args: string[]) => number
  write: (text: string) => void
}): number
