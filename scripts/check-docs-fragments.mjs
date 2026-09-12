// Entry point for the `DocsFragments` check (see checks/docs-fragments.ts).
//
// Closes a real, confirmed gap between the two existing docs checks:
//   - markdownlint's MD051 rule (`DocsMarkdown`) validates a bare `#fragment`
//     link against the current file's own real headings, but does NOT
//     resolve a `filename.md#fragment` link even when `filename.md` is the
//     current file itself -- confirmed directly: env-cap's and data-cap's
//     READMEs both shipped a `[badge](README.md#installation)`/
//     `(#installation)` link to a heading that never existed, and only the
//     bare form was ever caught.
//   - linkinator (`DocsLinks`) does not meaningfully validate fragments at
//     all -- confirmed directly (a `--recurse --markdown` crawl over a test
//     file with both a valid and a deliberately-broken `#fragment` link
//     reported neither as a distinct entry, only the base file).
//
// This script covers both blind spots for every *local* `.md` link,
// self-referencing or cross-file: it parses every scanned file's own real
// headings into GitHub-flavored-markdown slugs (via `github-slugger`, the
// same library markdownlint's own MD051 rule is built on, so results match
// GitHub's actual anchor behavior including per-file duplicate-heading
// suffixing), then resolves and checks every `#fragment` link's target file
// and fragment against that file's real slug set.
//
// Scope matches `DocsMarkdown`'s own default glob (`*.md docs/**/*.md`) --
// this check is deliberately the fragment-resolution complement to that
// check, not a broader documentation crawl. `docs/api-report/**` is
// excluded: generated API markdown, already covered by its own
// `docs:api:report:check` freshness gate, and not hand-authored prose worth
// this check's false-positive risk.
//
// Known, deliberate limitations (documented rather than silently wrong):
//   - only inline `[text](target)` links are parsed, not reference-style
//     `[text][ref]` / `[ref]: target` definitions (none exist in this
//     organization's docs today -- confirmed by direct search across every
//     consumer repo before this check was written).
//   - an explicit HTML anchor (`<a id="foo">`) is not recognized as a valid
//     fragment target, only an auto-generated heading anchor.
//   - a target file that does not exist on disk is skipped, not reported --
//     that is `DocsLinks`' job (linkinator does correctly catch a missing
//     *file*, just not a missing *fragment*).

import { readFile, glob } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import GithubSlugger from "github-slugger"

const EXCLUDED_DIR_PREFIXES = ["docs/api-report/"]

/** Strips fenced code blocks (``` or ~~~, undented only) to plain-line placeholders, so neither heading extraction nor link scanning ever treats an example's own `#`/`[...]( )` text as real. */
function stripFencedCodeBlocks(content) {
  const lines = content.split("\n")
  let inFence = false
  let fenceMarker = ""
  return lines
    .map((line) => {
      const fenceMatch = /^(```+|~~~+)/.exec(line)
      if (fenceMatch) {
        if (!inFence) {
          inFence = true
          fenceMarker = fenceMatch[1][0]
          return ""
        }
        if (line.startsWith(fenceMarker)) {
          inFence = false
          return ""
        }
      }
      return inFence ? "" : line
    })
    .join("\n")
}

/** Converts inline link/image markdown to plain text (keeping a link's own visible text, dropping an image entirely) -- `github-slugger` strips punctuation character-by-character and has no notion of markdown syntax, so `[Link text](url)` must become `Link text` *before* slugging or the URL's own characters pollute the slug. */
function toPlainHeadingText(raw) {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
}

/** Every heading in `content`, as `{ line, slug }`, in document order -- duplicate heading text gets GitHub's own `-1`/`-2`/... suffix, via one `GithubSlugger` instance per file (its dedup state is intentionally per-document). */
function extractHeadingSlugs(content) {
  const slugger = new GithubSlugger()
  const slugs = new Set()
  const lines = stripFencedCodeBlocks(content).split("\n")
  const headingPattern = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
  for (const line of lines) {
    const match = headingPattern.exec(line)
    if (!match) continue
    const text = toPlainHeadingText(match[2]).trim()
    if (text.length === 0) continue
    slugs.add(slugger.slug(text))
  }
  return slugs
}

/** Every local `#fragment` link in `content`, as `{ line, target, fragment }` -- `target` is `""` for a bare same-file `#fragment` link. External (`http(s)://`, `mailto:`, etc.) and fragment-less links are not returned. */
function extractFragmentLinks(content) {
  const stripped = stripFencedCodeBlocks(content)
  const lines = stripped.split("\n")
  const links = []
  const linkPattern = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  lines.forEach((line, index) => {
    for (const match of line.matchAll(linkPattern)) {
      const href = match[1]
      const hashIndex = href.indexOf("#")
      if (hashIndex === -1) continue
      const target = href.slice(0, hashIndex)
      const fragment = href.slice(hashIndex + 1)
      if (fragment.length === 0) continue
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue // scheme-qualified (http:, mailto:, ...): not local
      if (target.length > 0 && !target.toLowerCase().endsWith(".md")) continue // only self (bare `#frag`) or another markdown file
      links.push({ line: index + 1, target, fragment })
    }
  })
  return links
}

function isExcluded(relPath) {
  const normalized = relPath.replace(/\\/g, "/")
  return EXCLUDED_DIR_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

async function main() {
  const root = process.cwd()
  const found = new Set()
  for await (const entry of glob("*.md", { cwd: root })) found.add(entry)
  for await (const entry of glob("docs/**/*.md", { cwd: root })) {
    if (!isExcluded(entry)) found.add(entry)
  }

  const files = [...found].sort()
  const slugCache = new Map()
  const contentCache = new Map()

  async function slugsFor(relPath) {
    const cached = slugCache.get(relPath)
    if (cached) return cached
    const absolute = path.join(root, relPath)
    if (!existsSync(absolute)) return undefined
    let content = contentCache.get(relPath)
    if (content === undefined) {
      content = await readFile(absolute, "utf8")
      contentCache.set(relPath, content)
    }
    const slugs = extractHeadingSlugs(content)
    slugCache.set(relPath, slugs)
    return slugs
  }

  const broken = []

  for (const relPath of files) {
    const content = await readFile(path.join(root, relPath), "utf8")
    contentCache.set(relPath, content)
    const links = extractFragmentLinks(content)
    if (links.length === 0) continue

    const sourceDir = path.dirname(relPath)
    for (const link of links) {
      const targetRelPath =
        link.target.length === 0 ? relPath : path.normalize(path.join(sourceDir, link.target))
      const slugs = await slugsFor(targetRelPath)
      if (slugs === undefined) continue // target file doesn't exist -- DocsLinks' job, not this check's.
      if (slugs.has(link.fragment.toLowerCase())) continue

      broken.push({
        file: relPath,
        line: link.line,
        target: link.target.length === 0 ? relPath : targetRelPath,
        fragment: link.fragment,
        availableFragments: [...slugs].sort(),
      })
    }
  }

  process.stdout.write(JSON.stringify({ ok: true, broken }))
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }))
  process.exitCode = 1
})
