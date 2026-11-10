/**
 * Runs a browser bundle where nothing from Node exists, and hands back what it exported.
 *
 * A package that says an entry point runs in a browser or an edge runtime proves it by bundling the entry for
 * the browser and running the result here: a `vm` context that has JavaScript's own intrinsics and the host
 * globals a browser offers, and no `process`, `Buffer`, `require` or `node:` anything. A bundle that reaches
 * for one of those throws a `ReferenceError` on the spot, which is the failure the test wants to see, instead
 * of a grep over the bundle text that a renamed identifier could slip past.
 *
 * The bundle is an IIFE that assigns its exports to one global (`esbuild --format=iife --global-name=<name>`),
 * because a module cannot be instantiated in a `vm` context without a flag Node still marks experimental.
 * Carried into packages as a managed copy (`test/_ipc/vm-bundle.ts`).
 */
import { createContext, runInContext } from "node:vm"

/** The host globals a browser or edge runtime offers; JavaScript's own intrinsics are in every context already. */
export const HOST_GLOBALS: readonly string[] = Object.freeze([
  "console",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "atob",
  "btoa",
  "structuredClone",
  "setTimeout",
  "clearTimeout",
  "queueMicrotask",
  "crypto",
])

export interface VmBundleOptions {
  /** More globals the bundle may see, for example a stub `fetch`; they are added after {@link HOST_GLOBALS}. */
  readonly globals?: Readonly<Record<string, unknown>>
}

/**
 * @param code - the IIFE bundle.
 * @param globalName - the global the bundle assigns its exports to.
 * @param options - extra globals.
 * @returns the bundle's exports.
 * @throws whatever the bundle throws while running, and an `Error` when it assigned no object to `globalName`.
 */
export function runBundleInVm(
  code: string,
  globalName: string,
  options: VmBundleOptions = {},
): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {}
  for (const name of HOST_GLOBALS) sandbox[name] = (globalThis as Record<string, unknown>)[name]
  Object.assign(sandbox, options.globals)
  const context = createContext(sandbox)
  runInContext(code, context, { filename: `${globalName}.bundle.js` })
  const exported = sandbox[globalName]
  if (typeof exported !== "object" || exported === null) {
    throw new Error(
      `the bundle assigned no object to \`${globalName}\`: build it with esbuild's --format=iife --global-name=${globalName}`,
    )
  }
  return exported as Record<string, unknown>
}
