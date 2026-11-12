/**
 * The filesystem a package's `./build` entry is handed by its caller.
 *
 * `./build` is a library surface, so it never imports `node:fs` itself (the `no-node-fs` rule enforces that).
 * Every public options object carries a required `fs` of this type. The CLI builds one over `node:fs/promises`;
 * a test hands in the same adapter or an in-memory fake. Real filesystem work still happens; the capability is
 * handed in rather than acquired.
 *
 * The signatures mirror `node:fs/promises`, so a thin adapter is a drop-in value. The entry and stat types are
 * structural ({@link BuildDirent}, {@link BuildStats}) rather than Node's own, so the boundary does not leak
 * Node's types. Only the operations the build code calls are declared.
 *
 * This file is the canonical source; a package carries a managed copy (`src/_ipc/build-fs.ts`, see `sync`).
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
