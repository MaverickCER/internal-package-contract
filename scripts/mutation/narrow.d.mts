export function narrowMutation(scope: { scope: string; mutate?: readonly string[] } | undefined): {
  skip: boolean
  args: string[]
  key: string
}
