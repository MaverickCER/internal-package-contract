/**
 * The marker every generated file starts with, and the two standing notices every governance-adjacent
 * artifact carries, written once for every MaverickCER package that generates files.
 *
 * This file is the canonical source. A package that uses it holds a managed copy (see `sync`), so it
 * needs no dependency on this repository at runtime. It is deliberately self-contained: no imports, no
 * Node APIs, no environment access, so it is safe in any bundle.
 *
 * One marker means one place decides what "generated" looks like: the code that writes the marker and the
 * code that reads it (to refuse to overwrite a hand-written file, or to ignore a file that only imports a
 * generated one) can never drift apart.
 */

/** What differs between packages; everything else is shared. */
export interface GeneratedBannerOptions {
  /** The package's short name, as its documentation names it, for example `env-cap`. */
  readonly product: string
  /** The page that describes the package's Evidence Model. */
  readonly guideUrl: string
  /** The command that regenerates what the CLI writes, for example `npx env-cap`. */
  readonly cliCommand: string
  /** How to regenerate a report the CLI does not write (it is produced by the project's own script). */
  readonly reportRegenerateHint: string
}

/** The functions a package's generated-file code uses. */
export interface GeneratedBanner {
  /** @returns how to regenerate a report the CLI does not write. */
  readonly reportRegenerateHint: () => string
  /**
   * Renders the "do not edit by hand" marker in the given comment syntax.
   * @param format - Comment syntax to render in.
   * @param regenerate - How to regenerate; defaults to the CLI, which writes the manifest.
   * @returns The comment line.
   */
  readonly generatedBanner: (format?: "ts" | "markdown", regenerate?: string) => string
  /**
   * Whether `content` carries a marker, as the opening of a `//` or `<!--` comment, within its first 20 non-empty lines.
   * @param content - A file's text.
   * @returns `true` when the file is generated.
   */
  readonly isGeneratedFile: (content: string) => boolean
  /** @returns the short disclaimer stamped into every artifact that renders sensitivity, ownership or expiry claims. */
  readonly evidenceDisclaimer: () => string
  /**
   * States that an artifact is a projection of the Evidence Model, by concept, and by path when one is known.
   * @param evidencePath - The path the evidence was also written to, when this run wrote it.
   * @returns The note.
   */
  readonly evidenceProjectionNote: (evidencePath?: string) => string
}

/**
 * The literal marker. A function, not a module-level `const`: a `const` string's mutants are evaluated once
 * at module load and cannot be attributed to the test that covers them under mutation testing's per-test
 * coverage (a false survivor); a function's literal is evaluated per call, like any other code.
 */
function marker(): string {
  return "GENERATED FILE -- do not edit by hand"
}

/**
 * @param describe - Returns what differs for this package. A function, not an object, for the same reason
 *   as the marker: an object literal written at module level is evaluated once at load, so mutation
 *   testing cannot attribute its values to the tests that pin them; a function's literals are evaluated
 *   per call.
 * @returns the package's generated-file functions.
 */
export function createGeneratedBanner(describe: () => GeneratedBannerOptions): GeneratedBanner {
  return {
    reportRegenerateHint: () => describe().reportRegenerateHint,

    generatedBanner: (
      format = "ts",
      regenerate = `Run \`${describe().cliCommand}\` to regenerate.`,
    ) => {
      const text = `${marker()}. ${regenerate}`
      // An object lookup, not a `format === "ts" ? ... : ...` ternary: with only two values, a ternary's
      // untaken branch is an equivalent-mutant magnet. A mutated key here returns `undefined`, which every
      // caller and test can observe.
      return { ts: `// ${text}`, markdown: `<!-- ${text} -->` }[format]
    },

    // Not a bare `startsWith`: a shebang, a `"use strict"` pragma or a license header pushes a real marker
    // off line one, and a stricter check would read a genuinely generated file as hand-written, which a
    // dependency scan would take as "a real consumer imports this" and so permanently mask an abandoned
    // contract. The first 20 non-empty lines clear every realistic preamble without scanning a whole file.
    // A line counts only when the marker opens a comment, as `generatedBanner` writes it, so code or prose that
    // merely quotes the marker is not mistaken for a generated file.
    isGeneratedFile: (content) => {
      // Lines are produced one at a time and reading stops at the twentieth non-empty one, so a file of any
      // length costs the same; splitting the whole text first made the cost grow with the file.
      let seen = 0
      for (const [line] of content.matchAll(/[^\n]*/g)) {
        const text = line.trimStart()
        if (text === "") continue
        if (text.startsWith(`// ${marker()}`) || text.startsWith(`<!-- ${marker()}`)) return true
        seen += 1
        if (seen === 20) break
      }
      return false
    },

    evidenceDisclaimer: () =>
      "Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.",

    evidenceProjectionNote: (evidencePath) => {
      const { product, guideUrl } = describe()
      const concept = `Projected from ${product}'s Evidence Model (${guideUrl}), the same source every other generated artifact draws from.`
      return evidencePath === undefined
        ? concept
        : `${concept} This run also wrote it to \`${evidencePath}\`.`
    },
  }
}
