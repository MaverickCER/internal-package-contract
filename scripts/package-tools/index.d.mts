export interface ToolIo {
  out: (text: string) => void
  err: (text: string) => void
}
export const TOOLS: Readonly<
  Record<
    string,
    {
      run: (argv: readonly string[], cwd: string, io: ToolIo) => number | Promise<number>
      summary: string
    }
  >
>
export function run(argv: readonly string[], cwd: string, io: ToolIo): Promise<number>
