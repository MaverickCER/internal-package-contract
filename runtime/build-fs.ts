/**
 * The filesystem capability a package's `./build` entry requires from its caller.
 *
 * `./build` is a **library surface**: it must not acquire filesystem access
 * implicitly (no `node:fs` import outside the package's CLI). Every public options object carries a required
 * `fs` field of this type, and the caller supplies a concrete adapter: the CLI builds one over
 * `node:fs/promises`; a test builds either that same adapter or an in-memory fake.
 *
 * "Ambient-fs-free" means specifically: `./build` never reaches for
 * `node:fs` itself. It still performs real filesystem operations -- the
 * capability is always handed in.
 *
 * The shape is modeled on `node:fs/promises`'s own signatures so a thin
 * adapter is a drop-in value, but uses minimal structural types
 * ({@link BuildDirent}/{@link BuildStats}) rather than Node's `Dirent`/
 * `Stats` -- the capability boundary shouldn't leak Node's type surface just
 * because the concrete adapter happens to be Node-backed. Only the
 * operations the build code actually calls are here.
 */
export interface BuildFileSystem {
  /** Read a UTF-8 text file. Rejects if the path doesn't exist or isn't readable. */
  readonly readFile: (path: string, encoding: "utf8") => Promise<string>
  /** Write a UTF-8 text file, creating or truncating it. The parent directory must already exist. */
  readonly writeFile: (path: string, data: string, encoding: "utf8") => Promise<void>
  /** Create a directory and every missing parent. A no-op if it already exists. */
  readonly mkdir: (path: string, options: { readonly recursive: true }) => Promise<void>
  /** List a directory's entries with their file-type info. */
  readonly readdir: (
    path: string,
    options: { readonly withFileTypes: true },
  ) => Promise<readonly BuildDirent[]>
  /** Stat a path (following symlinks). Rejects if the path doesn't exist. */
  readonly stat: (path: string) => Promise<BuildStats>
  /** Resolve a path to its canonical, symlink-free absolute form. */
  readonly realpath: (path: string) => Promise<string>
}

/** One directory entry from {@link BuildFileSystem.readdir} -- the subset of Node's `Dirent` the build code reads. */
export interface BuildDirent {
  readonly name: string
  /** Same contract as Node's `Dirent.isDirectory()`. */
  readonly isDirectory: () => boolean
  /** Same contract as Node's `Dirent.isFile()`. */
  readonly isFile: () => boolean
}

/** A path's stat info from {@link BuildFileSystem.stat} -- the subset of Node's `Stats` the build code reads. */
export interface BuildStats {
  /** Same contract as Node's `Stats.isFile()`. */
  readonly isFile: () => boolean
  /** Size in bytes -- read by the package-schema resolver to enforce a size ceiling. */
  readonly size: number
}
