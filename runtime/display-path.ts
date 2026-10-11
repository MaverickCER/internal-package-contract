/**
 * The one place a filesystem path crosses from "real, absolute, usable for `fs` and import resolution" into
 * "the path a generated artifact publishes".
 *
 * Absolute paths originate once, at discovery, and are the right currency for every internal read, but they are
 * a bug in a published artifact: `/Users/someone/dev/app/src/user.ts` in a committed JSON or Markdown file is
 * machine-specific, makes two developers' (or CI's) regeneration differ for no real reason, and leaks a local
 * directory layout into a document meant to be reviewed and diffed. Models therefore store the root-relative
 * path, produced here at the last step before they are returned, and anything that later needs a real path
 * re-derives it with {@link absolutePathFrom}.
 *
 * This file is the canonical source; a package carries a managed copy (see `sync`). It uses only `node:path`.
 */
import path from "node:path"

/**
 * Renders `filePath` relative to `root`, POSIX-separated whatever the platform.
 *
 * Two deliberate non-conversions:
 *
 * - An already-relative `filePath` is returned as given (POSIX-normalized). That makes the function
 *   idempotent, which matters because a model's `file` is relativized once and then passed through render
 *   helpers that call this again. Resolving a relative path against `process.cwd()` first, which is what
 *   `path.relative` does on its own, silently gives a wrong answer whenever the working directory is not `root`.
 * - An absolute path that would need to climb outside `root` is returned unchanged, never rewritten into a
 *   `../` escape: a file discovered in another package legitimately lives outside `root`, and its absolute path
 *   is the only unambiguous thing to say about it.
 * @param root - The directory paths are published relative to.
 * @param filePath - An absolute path, or one already relative to `root`.
 * @returns The path to publish.
 */
export function displayPath(root: string, filePath: string): string {
  if (!path.isAbsolute(filePath)) return filePath.split(path.sep).join("/")
  const relative = path.relative(root, filePath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return filePath
  return relative.split(path.sep).join("/")
}

/**
 * The inverse of {@link displayPath}: turns a published `file` back into a real, absolute path for filesystem
 * or import work. `path.resolve` rather than `path.join`, because `displayPath` leaves an out-of-root absolute
 * path unchanged and `resolve` returns such a path untouched, where `join` would produce `root + absolute`.
 * @param root - The directory paths are published relative to.
 * @param filePath - A published path.
 * @returns The absolute path.
 */
export function absolutePathFrom(root: string, filePath: string): string {
  return path.resolve(root, filePath)
}
