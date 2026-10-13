// The imports of a package's tracked source that resolve only to a file git does not track. Everything a
// local gate reads comes from the working tree, so a file that is ignored by a pattern that is too wide, or
// was never added, passes every check on the machine that has it and is missing from every clean checkout,
// which is what CI and a consumer get.

import path from "node:path"

/** A file this reads for imports. */
export const SOURCE_FILE = /\.[cm]?[jt]sx?$/

/**
 * Folders a build, a test run or an install fills in, which are ignored on purpose: a file under one is not
 * source that a clean checkout is missing, it is produced there.
 */
export const GENERATED = [
  "node_modules/",
  "dist/",
  "coverage/",
  "reports/",
  ".stryker-tmp/",
  ".benchmark-local/",
]

/** A relative import, `export ... from`, dynamic `import()` or `require()`: group 1 is the specifier. */
const RELATIVE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']*)["']/g

/** What a specifier may resolve to when its extension is left out or written as the compiled one. */
const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".json",
  ".d.ts",
  ".d.mts",
  ".d.cts",
]

/**
 * @param {string} from - the importing file, relative to the root, with forward slashes.
 * @param {string} specifier - a relative specifier as written.
 * @returns {string[]} every file it can resolve to, relative to the root.
 */
export function candidates(from, specifier) {
  const base = path.posix.join(path.posix.dirname(from), specifier)
  const stem = base.replace(/\.[cm]?jsx?$/, "")
  return [
    base,
    ...EXTENSIONS.map((extension) => `${stem}${extension}`),
    ...EXTENSIONS.map((extension) => `${base}${extension}`),
    ...EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ]
}

/**
 * @param {{
 *   files: Record<string, string>,
 *   tracked: ReadonlySet<string>,
 *   existsOnDisk: (file: string) => boolean,
 * }} input - the text of each tracked source file, what git tracks, and whether a file is on disk.
 * @returns {{ file: string, specifier: string, target: string }[]} each import whose only targets on disk are
 *   not tracked. An import that resolves to nothing at all is the type check's to report, not this.
 */
export function untrackedImports({ files, tracked, existsOnDisk }) {
  /** @type {{ file: string, specifier: string, target: string }[]} */
  const found = []
  for (const [file, text] of Object.entries(files)) {
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const specifier = String(match[1])
      const options = candidates(file, specifier)
      if (options.some((option) => tracked.has(option))) continue
      const target = options.find(
        (option) => existsOnDisk(option) && !GENERATED.some((folder) => option.startsWith(folder)),
      )
      if (target !== undefined) found.push({ file, specifier, target })
    }
  }
  return found
}
