export function literalKeys(literal: string): string[]
export function keysOf(type: string, declared: Map<string, object>, depth?: number): string[]
export function parametersOf(list: string): { name: string; type: string }[]
export function signaturesOf(
  packages: object[],
  declarations?: string[],
): Map<string, { paths: string[]; multiInput: boolean }>
