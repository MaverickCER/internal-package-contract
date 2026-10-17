export const ADR_DIRECTORIES: string[]
export function findPrompts(text: string): { line: number; text: string }[]
export function findSurfaceTodos(text: string): { line: number; text: string }[]
export function adrDirectory(cwd: string): string | undefined
export function scanPackage(cwd: string): { file: string; line: number; text: string }[]
