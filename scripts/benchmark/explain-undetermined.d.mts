export function explainUndetermined(value: {
  reason?: string
  points?: number
  size?: number
  rSquared?: number | null
  exponent?: number | null
  minRSquared?: number
  discarded?: readonly { tier: string; why: string }[]
  unmeasured?: readonly { tier: string; status: string; message?: string }[]
  variable?: string
}): string
