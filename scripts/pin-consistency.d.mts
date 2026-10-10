export function devDependencyRef(packageJson: string): string | undefined
export function workflowPins(text: string): { line: number; ref: string; comment: string }[]
export function checkPins(input: {
  packageJson: string
  lockfile: string | undefined
  workflows: readonly { file: string; text: string }[]
}): { applies: boolean; problems: string[] }
