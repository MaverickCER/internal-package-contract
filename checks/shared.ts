/**
 * Small helpers shared by the recreated bespoke checks. repo-contract keeps the
 * equivalents in `src/presets/shared/` but does not export them, so the few
 * lines each are reproduced here.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { CheckEvidence, PolicyResult } from "repo-contract"

/** This package's own root, from `checks/shared.ts` -> `..`. */
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Absolute path to a file under this package's bundled `config/` directory. */
export function bundledConfig(relPath: string): string {
  return path.join(packageRoot, "config", relPath)
}

/**
 * The consumer's own config for a tool if one exists in `process.cwd()`, else the
 * bundled default. Resolution happens at contract-assembly time (when
 * `contract.ts` is evaluated with the consumer repo as cwd), so the chosen path
 * can be baked straight into a check's `run`.
 * @param consumerCandidates - config filenames to look for in the consumer repo, in priority order.
 * @param bundledRelPath - path under `config/` to fall back to.
 * @returns the absolute config path and whether it is the bundled default.
 */
export function resolveConfig(
  consumerCandidates: readonly string[],
  bundledRelPath: string,
): { readonly path: string; readonly isBundled: boolean } {
  const own = firstExisting(consumerCandidates)
  return own
    ? { path: path.join(process.cwd(), own), isBundled: false }
    : { path: bundledConfig(bundledRelPath), isBundled: true }
}

/** stdout + stderr, trimmed and joined -- for surfacing a tool's own error text in a rationale. */
export function combinedOutput(result: CheckEvidence): string {
  return [result.stdout.trim(), result.stderr.trim()].filter((s) => s.length > 0).join("\n")
}

/** A non-`completed` terminal status (timeout, signal, spawn error) -- the process never ran to its own exit, so its exit code means nothing. */
export function abnormalTermination(result: CheckEvidence, tool: string): string | undefined {
  if (result.status === "completed") return undefined
  if (result.status === "spawn_error") {
    return `${tool} could not be spawned (${result.spawnErrorCode ?? "spawn error"}): ${result.spawnError ?? "unknown error"}. Is it installed?`
  }
  return `${tool} did not run to completion (status: ${result.status}).`
}

/** The consumer's `package.json` `scripts`, read fresh from `process.cwd()`. `{}` if it can't be read. */
export function consumerScripts(): Readonly<Record<string, string>> {
  try {
    // Stryker disable next-line StringLiteral: an equivalent mutant -- `readFileSync(path, "")`
    // returns a Buffer instead of a string, but `JSON.parse` coerces any non-string argument via
    // its default (utf8) `toString()`, which produces byte-for-byte the same text `"utf8"` would
    // have decoded. Hand-verified: forcing this to `""` leaves every test in shared.test.ts
    // passing unchanged.
    const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> }
    return parsed.scripts ?? {}
  } catch {
    return {}
  }
}

/** Whether the consumer defines an npm script by this name. */
export function hasScript(name: string): boolean {
  return typeof consumerScripts()[name] === "string"
}

/** First existing path (relative to `process.cwd()`) from `candidates`, or `undefined`. */
export function firstExisting(candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => existsSync(path.join(process.cwd(), candidate)))
}

/**
 * Interprets a check's raw evidence as a `{ ok: boolean, ... }`-shaped JSON envelope emitted by
 * its own small wrapper script (`docsLinks`'s and `docsFragments`'s shared shape) -- fails closed
 * on abnormal termination or unparseable output before the caller ever sees a value, so both
 * checks' own `policy` reduces to interpreting an already-well-formed envelope.
 * @param result - the check's raw execution evidence.
 * @param tool - the underlying tool name, for `abnormalTermination`'s own "is it installed?" rationale.
 * @param rationalePrefix - everything before "output could not be parsed as JSON." in the unparseable-output rationale (e.g. `"Docs (links): linkinator"` or `"Docs (fragments):"`).
 * @returns the parsed envelope, or the `fail` `PolicyResult` the caller should return verbatim.
 */
export function parseToolEnvelope<T extends { readonly ok: boolean }>(
  result: CheckEvidence,
  tool: string,
  rationalePrefix: string,
):
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly result: PolicyResult } {
  const terminated = abnormalTermination(result, tool)
  if (terminated) return { ok: false, result: { outcome: "fail", rationale: terminated } }

  const parsed: unknown = result.output?.success ? result.output.value : undefined
  if (!parsed || typeof parsed !== "object" || !("ok" in parsed)) {
    const printed = combinedOutput(result)
    return {
      ok: false,
      result: {
        outcome: "fail",
        rationale: `${rationalePrefix} output could not be parsed as JSON.${printed ? `\n${printed}` : ""}`,
      },
    }
  }

  return { ok: true, value: parsed as T }
}
