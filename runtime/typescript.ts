/**
 * Loads the TypeScript compiler a package's build-time scanner parses with, and says which one it chose.
 * Written once for every package that scans TypeScript: the choice is by capability, never by version, and
 * the rules about when "not installed" is absence and when it is a broken install are subtle enough that two
 * hand-kept copies are a liability. This file is the canonical source; a package carries a managed copy
 * (see `sync`).
 */
import { createRequire } from "node:module"
import type TS from "typescript"

/** The compiler namespace the build-time scanner is written against. */
export type TypeScript = typeof TS

function hasClassicApi(candidate: unknown): candidate is TypeScript {
  return (
    typeof (candidate as { createSourceFile?: unknown } | null | undefined)?.createSourceFile ===
    "function"
  )
}

/**
 * Whether `error` says the module `id` itself is not installed. A `MODULE_NOT_FOUND` raised while an
 * installed module loads one of its own dependencies is a broken install, not an absent module, and
 * names a different module -- so the message has to name `id`.
 */
function isModuleNotFound(error: unknown, id: string): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND") return false
  return (
    typeof message === "string" &&
    (message.startsWith(`Cannot find module '${id}'`) ||
      message.startsWith(`Cannot find package '${id}'`))
  )
}

/**
 * Loads a module, treating only "not installed" as absence. Any other failure (a corrupt install, a
 * syntax error in the module) is rethrown rather than silently replaced by the fallback compiler.
 */
function tryLoad(load: (id: string) => unknown, id: string): unknown {
  try {
    return load(id)
  } catch (error) {
    if (isModuleNotFound(error, id)) return undefined
    throw error
  }
}

/**
 * Picks the compiler the scanner parses with: the consumer's `typescript` when it exposes the
 * classic compiler API (TypeScript 5 and 6), otherwise the bundled `@typescript/typescript6` --
 * Microsoft's side-by-side TypeScript 6 package, a dependency of the package so the scanner keeps working
 * for a consumer whose own `typescript` is 7+, which ships no programmatic API. Chosen by capability, never by version,
 * so a future `typescript` that regains the API is used as-is.
 *
 * When neither has the API (the bundled dependency was stripped from an install), it returns the
 * consumer's module anyway so `assertCompilerApi` -- called at every scanner entry point -- fails
 * with its readable message instead of a bare "is not a function".
 * @param load - How a module id is resolved (a parameter so a test can hand in stand-ins).
 * @throws Whatever `load` throws for a reason other than the module not being installed.
 */
export function pickCompiler(load: (id: string) => unknown): TypeScript {
  const consumer = tryLoad(load, "typescript")
  if (hasClassicApi(consumer)) return consumer
  const bundled = tryLoad(load, "@typescript/typescript6")
  if (hasClassicApi(bundled)) return bundled
  return (consumer ?? {}) as TypeScript
}

/** The compiler every scanner module parses with. Resolved once, synchronously, at import. */
export const ts: TypeScript = pickCompiler(createRequire(import.meta.url))
