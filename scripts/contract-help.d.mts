export interface Command {
  name: string
  group: "Start" | "Daily" | "Maintain"
  usage: string
  summary: string
  details: string
  options?: readonly (readonly [string, string])[]
}
export const COMMANDS: readonly Command[]
export function wantsHelp(argv: readonly string[]): boolean
export function helpText(): string
export function commandHelp(name: string | undefined): string | undefined
export function unknownCommand(argv: readonly string[]): string | undefined
export function nearest(word: string, names: readonly string[]): string | undefined
