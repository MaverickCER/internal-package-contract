export const MIN_REASON: number
export type Accounting =
  | { kind: "swept" }
  | { kind: "sweep" | "variant"; name: string }
  | { kind: "fixed" | "not covered"; reason: string }
export function parseAccounting(value: unknown): Accounting | undefined
