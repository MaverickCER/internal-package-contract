export const DEFERRED_CHECK: "SecuritySocket"
export function planPhases(
  available: readonly string[],
  requested: readonly string[] | undefined,
): { first: readonly string[]; deferred: string | undefined }
