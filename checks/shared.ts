/**
 * Small helpers shared by the recreated bespoke checks. repo-contract keeps the
 * equivalents in `src/presets/shared/` but does not export them, so the few
 * lines each are reproduced here.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { CheckDefinitionConfig, CheckEvidence, PolicyResult } from "repo-contract"

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

/** What a tool prints when it dies: `Error: ...`, `ConfigError: ...`, `Error [ERR_MODULE_NOT_FOUND]: ...`. */
const ERROR_LINE = /^[A-Za-z]*Error(?:\s\[\w+\])?: .+$/m

/**
 * @param result - a check's raw execution evidence.
 * @returns the first line on stderr that reads as an error a tool died with, or `undefined`.
 */
export function crashLine(result: CheckEvidence): string | undefined {
  return ERROR_LINE.exec(result.stderr)?.[0]
}

/** Starts a rationale that says a tool produced nothing usable, whatever the reason. */
const NOTHING_USABLE = /could not be parsed|did not evaluate|produced no output|exited \d+/i

/**
 * Makes a failing check lead with the error its tool died with. A tool that crashes before it prints leaves a
 * stack trace after a headline that blames something else ("output could not be parsed as JSON", "exited 1"),
 * so the cause sits below tens of lines. The whole original rationale, stack included, is kept after the
 * headline: the stack is what is needed to debug it.
 * @param checks - a set of check definitions, keyed by id.
 * @returns the same checks, each policy's failure led by the error when one is on stderr.
 */
export function withErrorHeadline<T extends Record<string, CheckDefinitionConfig>>(checks: T): T {
  return Object.fromEntries(
    Object.entries(checks).map(([id, definition]) => [
      id,
      {
        ...definition,
        policy: async (context: Parameters<CheckDefinitionConfig["policy"]>[0]) => {
          const verdict = await definition.policy(context)
          const crash = crashLine(context.result)
          if (
            verdict.outcome !== "fail" ||
            crash === undefined ||
            !NOTHING_USABLE.test(verdict.rationale.split("\n")[0] ?? "") ||
            verdict.rationale.split("\n")[0]?.includes(crash)
          ) {
            return verdict
          }
          return {
            ...verdict,
            rationale: `${id}: the tool stopped with an error before it produced a result: ${crash}\n${verdict.rationale}`,
          }
        },
      },
    ]),
  ) as T
}

/**
 * Why a check that should have printed one JSON document did not. A script that throws before it prints
 * leaves a stack trace on stderr and nothing on stdout; calling that "output could not be parsed as JSON" sends
 * the reader to the wrong place, so the first line of the error leads when there is one.
 * @param prefix - everything before the reason, for example `"ApiContract:"`.
 * @param result - the check's raw execution evidence.
 * @returns the rationale: the error that stopped the check when stderr has one, else the unparseable-output text, then whatever the tool printed.
 */
export function unparseableRationale(prefix: string, result: CheckEvidence): string {
  const printed = combinedOutput(result)
  const crash = crashLine(result)
  const head =
    crash === undefined
      ? `${prefix} check output could not be parsed as JSON.`
      : `${prefix} the check stopped with an error before it produced a result: ${crash}`
  return `${head}${printed ? `\n${printed}` : ""}`
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
