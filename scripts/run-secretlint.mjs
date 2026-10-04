// Runs secretlint over the files a repository actually has -- tracked, plus untracked but not git-ignored --
// instead of the `**/*` glob.
//
// secretlint expands `**/*` itself and applies its ignore file only afterwards, so on a working tree with
// generated output (a 700 MB `node_modules` inside an example, a `.next` cache, benchmark fixtures, a
// database binary) it walks every one of them first and can run for tens of minutes. The files git knows
// about are exactly the ones that could ever be committed or published, and listing them takes milliseconds.
// Outside a git repository, or when the list is too long for one command line, it falls back to the glob.
//
// Usage: node run-secretlint.mjs <secretlint args ending in the "**/*" glob>
import { sync as spawnSync } from "cross-spawn"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** The most bytes of file names put on one command line; macOS allows about 1 MB in total. */
export const MAX_ARGUMENT_BYTES = 400_000

/**
 * The files to scan.
 * @param {string} cwd - the repository root.
 * @returns {string[] | undefined} the file list, or undefined when git cannot provide one.
 */
export function listRepositoryFiles(cwd) {
  const listing = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  )
  if (listing.status !== 0 || typeof listing.stdout !== "string") return undefined
  const files = listing.stdout.split("\0").filter((name) => name.length > 0)
  return files.length === 0 ? undefined : files
}

/**
 * Replaces the trailing glob with the file list when one is available and fits.
 * @param {string[]} args - the secretlint arguments, the last being the glob.
 * @param {string[] | undefined} files
 * @returns {string[]}
 */
export function withFileList(args, files) {
  if (files === undefined) return args
  const bytes = files.reduce((total, name) => total + name.length + 1, 0)
  if (bytes > MAX_ARGUMENT_BYTES) return args
  return [...args.slice(0, -1), ...files]
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command = "secretlint", ...args] = process.argv.slice(2)
  const result = spawnSync(command, withFileList(args, listRepositoryFiles(process.cwd())), {
    stdio: "inherit",
  })
  process.exit(result.status ?? 1)
}
