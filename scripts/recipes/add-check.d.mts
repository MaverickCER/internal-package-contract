export function planAddCheck(input: { name: string; packageJson: string | undefined }): {
  problems: string[]
  text?: string
  already?: boolean
}
