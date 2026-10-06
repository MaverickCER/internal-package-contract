import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import type { RequiredReleaseLevel } from "./evidence-types.js"
import { maxLevel } from "./levels.js"

/**
 * Derives the SemVer bump a package's pending Changesets declare, by reading `.changeset/*.md`
 * directly off disk -- the same files `changeset version` itself consumes. Replaces repo-contract's
 * own `conventional-commits.ts`: that reader inferred the declared bump from Conventional Commit
 * headers, which matched repo-contract's release-please-driven history but not this fleet's actual
 * release mechanism -- every consumer (including repo-contract, since its own migration off
 * release-please) versions via Changesets, so the declared bump this check compares against must
 * come from the same changeset files Changesets itself reads, not from commit message parsing.
 */

const FRONTMATTER_DELIMITER = "---"

// A changeset frontmatter bump line: `"<package-name>": <bump>` or `'<package-name>': <bump>` or
// an unquoted package name. Hand-parsed per line rather than a YAML dependency -- the shape
// Changesets itself writes is fixed and small (one `name: level` mapping per line).
const BUMP_LINE_PATTERN = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/

/**
 * @param content - One `.changeset/*.md` file's full text.
 * @returns The lines between the file's first two `---` delimiters (its YAML frontmatter), or `[]` if the file has no well-formed frontmatter block.
 */
function extractFrontmatterLines(content: string): readonly string[] {
  const lines = content.split(/\r?\n/)
  const opens = lines[0]?.trim() === FRONTMATTER_DELIMITER
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER,
  )
  // An empty slice rather than a literal `[]`: no frontmatter, no bump lines.
  return opens && closingIndex !== -1 ? lines.slice(1, closingIndex) : lines.slice(0, 0)
}

/**
 * @param content - One `.changeset/*.md` file's full text.
 * @param packageName - The current package's own `package.json` `name`, e.g. "@maverickcer/env-cap".
 * @returns The bump this changeset declares for `packageName`, or `undefined` if it doesn't name it.
 */
function declaredLevelForPackage(
  content: string,
  packageName: string,
): RequiredReleaseLevel | undefined {
  for (const line of extractFrontmatterLines(content)) {
    const match = BUMP_LINE_PATTERN.exec(line)
    if (!match) continue
    const [, name, level] = match
    if (name === packageName) return level as RequiredReleaseLevel
  }
  return undefined
}

/**
 * @param root - Absolute path to the consumer's project root; may or may not contain a `.changeset/` directory.
 * @param packageName - The current package's own `package.json` `name`.
 * @returns Every pending `.changeset/*.md` entry (excluding `README.md`) that names `packageName`, and the largest bump they collectively declare.
 */
export async function declaredLevelFromChangesets(
  root: string,
  packageName: string,
): Promise<{ readonly changesetCount: number; readonly declaredLevel: RequiredReleaseLevel }> {
  const changesetDir = path.join(root, ".changeset")

  let entries: readonly string[]
  try {
    entries = (await readdir(changesetDir)).filter(
      (name) => name.endsWith(".md") && name !== "README.md",
    )
  } catch {
    // No `.changeset/` directory at all -- treated the same as "no pending changesets", not an
    // error: a fresh checkout between releases legitimately has none.
    return { changesetCount: 0, declaredLevel: "none" }
  }

  let changesetCount = 0
  let declaredLevel: RequiredReleaseLevel = "none"

  for (const entry of entries) {
    const content = await readFile(path.join(changesetDir, entry), "utf8")
    const level = declaredLevelForPackage(content, packageName)
    if (level === undefined) continue
    changesetCount += 1
    declaredLevel = maxLevel(declaredLevel, level) ?? declaredLevel
  }

  return { changesetCount, declaredLevel }
}
