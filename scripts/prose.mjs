// The scan behind the `Prose` check (checks/prose.ts): no em-dash and no ` -- ` dash substitute in the
// prose a package writes. Prose is Markdown outside code, comments in TypeScript and JavaScript, and
// full-line comments in YAML and shell files. Code, strings and code spans are never read as prose, and
// a comment that is a tool directive (ESLint's `-- reason` syntax among them) is skipped whole.
//
// Not read: the CHANGELOG and decision records (history), third-party text (CODE_OF_CONDUCT.md), and
// anything under node_modules or a fixtures directory. Generated files are not read either: API reports,
// benchmark reports, and any file whose first lines mark it generated. A generated file's prose comes from its generator's strings, which
// this scan does not read either.

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
/** @type {typeof import("typescript")} */
const ts = require("typescript")

/** A dash substitute standing alone between spaces, or an em-dash. */
const DASH = /(?<=\s)--(?=\s|$)|—/g

/** Comments that carry their own syntax for another tool. */
const DIRECTIVE =
  /eslint-(?:disable|enable)|^\/\*\s*(?:eslint|global)\s|oxlint-|Stryker (?:disable|restore)|@ts-(?:expect-error|ignore|nocheck)|(?:v8|c8|istanbul) ignore|prettier-ignore|biome-ignore|knip-ignore|markdownlint-|jscpd:|@vitest-environment/

const EXCLUDED =
  /(^|\/)(node_modules|fixtures?|__snapshots__)\/|(^|\/)(decisions|adr)\/|^docs\/api-report\/|^docs\/api\/|(^|\/)CHANGELOG\.md$|(^|\/)CODE_OF_CONDUCT\.md$|(^|\/)BENCHMARKS\.md$|\.d\.[cm]?ts$/

/** A marker in a file's first lines that says a tool wrote it. */
const GENERATED = /GENERATED FILE|Machine-generated|@generated|do not edit by hand/i

/**
 * @param {string} text - a file's content.
 * @returns {boolean} whether its first ten lines mark it as generated.
 */
export function isGenerated(text) {
  return GENERATED.test(text.split("\n", 10).join("\n"))
}

/**
 * @param {string} file - repo-relative path.
 * @returns {boolean} whether the file holds prose this check reads.
 */
export function isProseFile(file) {
  if (EXCLUDED.test(file)) return false
  return /\.(md|[cm]?[jt]sx?|ya?ml|sh)$/.test(file)
}

/**
 * Blanks code spans so a dash inside one is not prose. A span opens and closes with the same run of
 * backticks and may wrap across lines, as Markdown allows; line breaks are kept so line numbers hold.
 */
const blankSpans = (text) =>
  text.replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, (m) => m.replace(/[^\n]/g, " "))

/**
 * @param {string} text - a Markdown document.
 * @returns {number[]} 1-based lines with a dash in prose.
 */
function markdownLines(text) {
  let fence = ""
  let comment = false
  /** @returns whether a line is prose, tracking the fence or HTML comment it opens or closes. */
  const isProse = (line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence === "" && marker !== undefined) {
      fence = marker[0]
      return false
    }
    if (fence !== "") {
      if (marker?.[0] === fence) fence = ""
      return false
    }
    // An HTML comment (a generated-region marker, a lint directive) is not prose.
    if (comment) {
      if (line.includes("-->")) comment = false
      return false
    }
    if (line.includes("<!--")) {
      comment = !line.slice(line.indexOf("<!--")).includes("-->")
      return false
    }
    return !/^ {4}|^\t/.test(line)
  }
  // Lines that are not prose (fences, indented code, HTML comments) are emptied first, so a span is
  // matched across prose lines only.
  // Stryker disable next-line StringLiteral: any filler without a dash or a backtick reads the same as an empty line.
  const prose = text.split("\n").map((line) => (isProse(line) ? line : ""))
  const hits = []
  blankSpans(prose.join("\n"))
    .split("\n")
    .forEach((line, i) => {
      if (DASH.test(line)) hits.push(i + 1)
      DASH.lastIndex = 0
    })
  return hits
}

/**
 * Every comment in a TypeScript or JavaScript source, found through the parsed syntax tree so a template
 * literal or a regular expression never hides the comments after it. Each node is asked for the comments
 * leading up to its full start and for the ones trailing its end on the same line.
 * @param {string} file - the path, which picks TSX or JSX parsing.
 * @param {string} text - the source.
 * @returns {[number, number][]} the comments' start and end offsets, sorted, without repeats.
 * @internal Exported for direct unit coverage.
 */
export function commentRanges(file, text) {
  const kind = /\.[jt]sx$/.test(file)
    ? ts.ScriptKind.TSX
    : /\.[cm]?js$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
  // Stryker disable next-line BooleanLiteral: parent links change no comment range, since `getChildren` is given the source file.
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind)
  const found = new Map()
  const add = (ranges) => {
    for (const range of ranges ?? []) found.set(range.pos, range.end)
  }
  // `getChildren` includes punctuation tokens and the end-of-file token, so a comment after a comma, before
  // a closing brace or at the end of the file leads some token, not only one beside a node.
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()))
    add(ts.getTrailingCommentRanges(text, node.getEnd()))
    for (const child of node.getChildren(source)) visit(child)
  }
  visit(source)
  return [...found].sort((a, b) => a[0] - b[0])
}

/**
 * @param {string} file - the path, which picks the parser.
 * @param {string} text - a TypeScript or JavaScript source.
 * @returns {number[]} 1-based lines of comments with a dash.
 */
function codeCommentLines(file, text) {
  const hits = new Set()
  // Consecutive `//` lines are one comment for code spans: a span may wrap from one line to the next.
  // Stryker disable next-line ArrayDeclaration: a seeded string never joins a comment, since no `//` comment both starts the file and follows a newline, and it slices to an empty body.
  const blocks = []
  for (const [start, end] of commentRanges(file, text)) {
    const last = blocks[blocks.length - 1]
    if (
      last !== undefined &&
      text.startsWith("//", last[0]) &&
      text.startsWith("//", start) &&
      /^[ \t]*\r?\n[ \t]*$/.test(text.slice(last[1], start))
    )
      last[1] = end
    else blocks.push([start, end])
  }
  for (const [start, end] of blocks) {
    const body = text.slice(start, end)
    if (DIRECTIVE.test(body)) continue
    const firstLine = text.slice(0, start).split("\n").length
    blankSpans(body)
      .split("\n")
      .forEach((line, offset) => {
        if (DASH.test(line)) hits.add(firstLine + offset)
        DASH.lastIndex = 0
      })
  }
  // Blocks run in file order and lines within a block ascend, so the hits are already sorted.
  return [...hits]
}

/**
 * @param {string} text - a YAML or shell file.
 * @returns {number[]} 1-based lines of full-line comments with a dash.
 */
function hashCommentLines(text) {
  const hits = []
  text.split("\n").forEach((line, i) => {
    if (/^\s*#(?!!)/.test(line) && !DIRECTIVE.test(line) && DASH.test(blankSpans(line))) {
      hits.push(i + 1)
    }
    DASH.lastIndex = 0
  })
  return hits
}

/**
 * @param {string} file - repo-relative path, which picks the reader.
 * @param {string} text - the file's content.
 * @returns {number[]} 1-based lines where prose carries an em-dash or a ` -- ` dash substitute.
 */
export function proseDashLines(file, text) {
  if (file.endsWith(".md")) return markdownLines(text)
  if (/\.(ya?ml|sh)$/.test(file)) return hashCommentLines(text)
  return codeCommentLines(file, text)
}
