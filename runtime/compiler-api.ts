/**
 * Fails with a readable message when neither the installed `typescript` nor the bundled
 * `@typescript/typescript6` exposes the classic compiler API (`createSourceFile`) the build-time scanner is
 * written against. TypeScript 7 ships no programmatic API, so a package normally falls back to the bundled
 * TypeScript 6 (see `typescript.ts`); this only fires when that dependency was stripped from the install, where
 * a raw call would die with "ts.createSourceFile is not a function".
 *
 * This file is the canonical source; a package carries a managed copy (see `sync`) and binds its own name.
 * @param product - The package's name, as users install it, for the message.
 * @param compiler - The resolved compiler module (a parameter so a test can hand in a stand-in).
 * @throws Error naming the installed version and how to restore the bundled compiler.
 */
export function assertCompilerApi(
  product: string,
  compiler: { readonly createSourceFile?: unknown; readonly version?: string },
): void {
  if (typeof compiler.createSourceFile === "function") return
  throw new Error(
    `${product}'s build-time scanner needs TypeScript's classic compiler API (typescript ^5 || ^6), but the installed typescript${
      compiler.version === undefined ? "" : ` ${compiler.version}`
    } does not expose it and the bundled @typescript/typescript6 could not be loaded. ` +
      `Reinstall ${product} with its dependencies, or provide a TypeScript 6 compiler: ` +
      "npm install --save-dev typescript@npm:@typescript/typescript6 (this swaps your `tsc` for `tsc6`; " +
      "to keep TypeScript 7's `tsc`, also add @typescript/native@npm:typescript@^7). " +
      "See VERSIONING.md, 'Supported toolchain'.",
  )
}
