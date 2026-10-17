/**
 * Converts one glob pattern to a `RegExp`. Handles `**` as "any number of path segments, including zero", so
 * `**\/node_modules/**` matches a root-level `node_modules` and `**\/x.ts` matches a root-level file, not
 * just nested ones; a plain `**` to `.*` substitution gets both wrong.
 *
 * One implementation for every package: build-time discovery and ESLint options need exactly the same matching,
 * and four hand-kept copies (two designs) had already accumulated. This file is the canonical source; a
 * package carries a managed copy (see `sync`).
 */
export function globToRegExp(pattern: string): RegExp {
  let out = ""
  // First index the loop still has to handle: a `**` segment consumes the characters after its first
  // `*`. The loop walks a finite list of the pattern's own characters, so it cannot run unbounded.
  let resume = 0
  for (const [i, char] of pattern.split("").entries()) {
    if (i < resume) continue
    if (char === "*" && pattern[i + 1] === "*") {
      const precededBySlashOrStart = i === 0 || pattern[i - 1] === "/"
      const followedBySlash = pattern[i + 2] === "/"
      if (precededBySlashOrStart && followedBySlash) {
        out += "(?:.*/)?"
        resume = i + 3 // skip the second '*' and the following '/'
      } else {
        out += ".*"
        resume = i + 2 // skip the second '*'
      }
    } else if (char === "*") {
      out += "[^/]*"
    } else if (char === "?") {
      out += "[^/]"
    } else if (".+^${}()|[]\\".includes(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return new RegExp(`^${out}$`)
}
