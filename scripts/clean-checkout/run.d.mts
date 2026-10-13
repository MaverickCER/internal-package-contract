export const OUTPUT_TAIL: number
export const SCRIPTS: string[]
export function checkCleanCheckout(
  cwd: string,
  seams?: {
    tracked?: (cwd: string) => string[] | undefined
    typecheck?: (work: string, script: string) => { status: number | null; output: string }
  },
): { state: "passed" | "failed" | "skipped"; output: string; reason?: string }
