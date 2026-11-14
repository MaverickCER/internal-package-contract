// Entry point for the `DocsFragments` check (see checks/docs-fragments.ts). Checks that every local
// `#fragment` link in the hand-written Markdown names a heading that exists, and prints one JSON envelope:
// `{ ok: true, broken }` or `{ ok: false, error }`. The policy decides the verdict.
//
// Why a check of its own: markdownlint's MD051 (`DocsMarkdown`) resolves a bare `#fragment` against the
// current file but not a `file.md#fragment` link, and linkinator (`DocsLinks`) does not judge fragments.
// Both forms are covered here, same-file and cross-file.
//
// What is read: `*.md` at the root and `docs/**/*.md`, the same files `DocsMarkdown` reads, minus
// `docs/api-report/**`, which is generated and has its own freshness check. Fenced code blocks are blanked
// before headings or links are read, so an example never counts as either. A heading becomes the slug
// GitHub gives it, through `github-slugger`, duplicate suffixes included; an explicit `<a id>` or `<a name>`
// counts as a heading too.
//
// Known limits: only inline `[text](target)` links are parsed, not reference-style links. A target file
// that does not exist is skipped, not reported: a missing file is `DocsLinks`' finding.

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

/** Converts inline link/image markdown to plain text, keeping a link's own visible text and dropping an image entirely. `github-slugger` strips punctuation character-by-character and has no notion of markdown syntax. So `[Link text](url)` must become `Link text` *before* slugging, or the URL's own characters pollute the slug. */
function toPlainHeadingText(raw) {
  const text = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  // One pass can leave a tag behind (`<<b>b>` -> `<b>`), so strip until nothing changes.
  let stripped = text
  let previous
  do {
    previous = stripped
    stripped = stripped.replace(/<[^>]+>/g, "")
  } while (stripped !== previous)
  return stripped
}

/** Every explicit HTML anchor (`<a id="x">`, `<a name="x">`) outside a code block: GitHub and every renderer resolve `#x` to it, and a generated document (the environment catalog) relies on them. */
function extractHtmlAnchors(content) {
  const ids = new Set()
  for (const match of stripFencedCodeBlocks(content).matchAll(
    /<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi,
  )) {
    ids.add(match[1].toLowerCase())
  }
  return ids
}

/** Every heading in `content`, as `{ line, slug }`, in document order: duplicate heading text gets GitHub's own `-1`/`-2`/... suffix, via one `GithubSlugger` instance per file (its dedup state is intentionally per-document). */
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
  for (const id of extractHtmlAnchors(content)) slugs.add(id)
  return slugs
}

/** Every local `#fragment` link in `content`, as `{ line, target, fragment }`: `target` is `""` for a bare same-file `#fragment` link. External (`http(s)://`, `mailto:`, etc.) and fragment-less links are not returned. */
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
      if (slugs === undefined) continue // target file doesn't exist: DocsLinks' job, not this check's.
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
