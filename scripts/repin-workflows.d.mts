export function repinWorkflowText(
  text: string,
  dependency: string,
  sha: string,
  ref: string,
): { text: string; changed: number }
export function repinWorkflows(dir: string, dependency: string, sha: string, ref: string): string[]
