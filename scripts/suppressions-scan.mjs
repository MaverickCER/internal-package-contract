// Finds every suppression comment in a repository: each place a source file tells a tool not to
// enforce one of its rules (ESLint, TypeScript, Stryker, V8/c8/Istanbul coverage, jscpd, Prettier,
// markdownlint, secretlint).
//
// A suppression is an exception to the standard written as a comment, and a comment is the weakest
// possible place for one: nothing reads it back, nothing notices when it stops being true, and nothing
// counts them. This module is the "read it back" half. It reports each suppression with the tool it
// silences, the rule, where it is, and the reason it gives; the `Suppressions` check
// (checks/suppressions.ts) then holds each to the policy, and the whole list is the check's evidence.
//
// Comments are found by parsing each file with the TypeScript scanner, not by searching text, so a
// string literal or a doc example that merely MENTIONS `eslint-disable` is never counted.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

/** The tools whose suppressions are governed. */
export const DOMAINS = [
  "eslint",
  "typescript",
  "stryker",
  "coverage",
  "jscpd",
  "prettier",
  "markdownlint",
  "secretlint",
]

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])

/** Generated, vendored or scaffolded trees that are not this repository's own source. */
const EXCLUDED_PREFIXES = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "reports/",
  ".stryker-tmp/",
  "docs/api/",
  "docs/api-report/",
  "template/",
]
const EXCLUDED_SEGMENTS = ["/node_modules/", "/fixtures/", "/dist/"]

/** How many characters of words a reason needs to count as one. */
export const MIN_REASON_LENGTH = 15
/** The same, for a reason given as the comment block above a directive that cannot carry one itself. */
export const MIN_BLOCK_REASON_LENGTH = 30

/**
 * @typedef {object} Suppression
 * @property {string} id - `suppression:<domain>:<rule>:<file>:<12-hex anchor>`, anchored to the directive and the code it covers, not to a line number.
 * @property {string} domain
 * @property {string} rule - what is silenced; `*` for a blanket suppression with no rule named.
 * @property {string} directive - the comment's directive keyword, e.g. `eslint-disable-next-line`.
 * @property {string} file
 * @property {number} line - 1-indexed; informational only (the id does not depend on it).
 * @property {string} reason - the reason given on the directive itself; may be empty.
 * @property {string} blockReason - the contiguous comment block directly above it, when the directive carries none.
 * @property {boolean} blanket - it names no rule, or it is a form the standard never allows (`@ts-ignore`, `@ts-nocheck`).
 * @property {boolean} documented - it gives a reason, on the directive or in the comment block above.
 * @property {boolean} closing - it ends a region opened earlier (`stop`, `end`, `enable`, `restore`); counted for pairing, never for policy.
 */

/**
 * @param {string} text
 * @returns {string} the text, whitespace collapsed.
 */
function squash(text) {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Splits `rules -- reason` / `rules: reason` into its two halves.
 * @param {string} rest - what follows the directive keyword.
 * @param {boolean} colonSeparates - whether `:` also ends the rule list (Stryker's convention).
 * @returns {{ rules: string[], reason: string }}
 */
function splitRulesAndReason(rest, colonSeparates) {
  const flat = squash(rest)
  const dash = flat.indexOf(" -- ")
  const dashAtStart = flat.startsWith("-- ")
  const colon = colonSeparates ? flat.indexOf(":") : -1
  let cut = -1
  let skip = 0
  if (dashAtStart) {
    cut = 0
    skip = 3
  } else if (dash !== -1 && (colon === -1 || dash < colon)) {
    cut = dash
    skip = 4
  } else if (colon !== -1) {
    cut = colon
    skip = 1
  }
  const head = cut === -1 ? flat : flat.slice(0, cut)
  const reason = cut === -1 ? "" : flat.slice(cut + skip).trim()
  const rules = head
    .split(/[,\s]+/)
    .map((r) => r.trim())
    .filter(Boolean)
  return { rules, reason }
}

/**
 * Parses one comment's body (delimiters removed) into the suppressions it contains.
 * @param {string} body - the comment text.
 * @param {"line" | "block"} kind
 * @returns {{ domain: string, directive: string, rules: string[], reason: string, blanket: boolean, closing: boolean }[]}
 */
export function parseDirective(body, kind) {
  // A block comment's lines may carry a leading `*`; the directive is the first thing in the comment.
  const text = (kind === "block" ? body.replace(/^\s*\*+/, "") : body).replace(/^\s+/, "")
  /** @type {RegExpExecArray | null} */
  let m

  if ((m = /^eslint-(disable-next-line|disable-line|disable|enable)\b([\s\S]*)$/.exec(text))) {
    const directive = `eslint-${m[1]}`
    const { rules, reason } = splitRulesAndReason(m[2] ?? "", false)
    return [
      {
        domain: "eslint",
        directive,
        rules,
        reason,
        blanket: m[1] !== "enable" && rules.length === 0,
        closing: m[1] === "enable",
      },
    ]
  }

  if ((m = /^@ts-(expect-error|ignore|nocheck)\b([\s\S]*)$/.exec(text))) {
    return [
      {
        domain: "typescript",
        directive: `@ts-${m[1]}`,
        rules: [`ts-${m[1]}`],
        reason: squash(m[2] ?? "").replace(/^(--|:)\s*/, ""),
        // `@ts-ignore` goes quiet when the error goes away and `@ts-nocheck` silences a whole file:
        // neither says what it excuses. `@ts-expect-error` fails the build once it stops being needed.
        blanket: m[1] !== "expect-error",
        closing: false,
      },
    ]
  }

  if ((m = /^Stryker\s+(disable|restore)\b([\s\S]*)$/.exec(text))) {
    const restore = m[1] === "restore"
    let rest = squash(m[2] ?? "")
    let directive = `Stryker ${m[1]}`
    if (/^next-line\b/.test(rest)) {
      directive += " next-line"
      rest = rest.replace(/^next-line\s*/, "")
    }
    const { rules, reason } = splitRulesAndReason(rest, true)
    return [{ domain: "stryker", directive, rules, reason, blanket: false, closing: restore }]
  }

  if ((m = /^(v8|c8|istanbul)\s+ignore\s+(next|start|stop|file|if|else)\b([\s\S]*)$/.exec(text))) {
    const { reason } = splitRulesAndReason(m[3] ?? "", false)
    return [
      {
        domain: "coverage",
        directive: `${m[1]} ignore ${m[2]}`,
        rules: [m[1] ?? "coverage"],
        reason,
        blanket: false,
        closing: m[2] === "stop",
      },
    ]
  }

  if ((m = /^jscpd:ignore-(start|end)\b([\s\S]*)$/.exec(text))) {
    const { reason } = splitRulesAndReason(m[2] ?? "", false)
    return [
      {
        domain: "jscpd",
        directive: `jscpd:ignore-${m[1]}`,
        rules: ["duplication"],
        reason,
        blanket: false,
        closing: m[1] === "end",
      },
    ]
  }

  if ((m = /^prettier-ignore\b([\s\S]*)$/.exec(text))) {
    return [
      {
        domain: "prettier",
        directive: "prettier-ignore",
        rules: ["format"],
        reason: squash(m[1] ?? "").replace(/^(--|:)\s*/, ""),
        blanket: false,
        closing: false,
      },
    ]
  }

  if ((m = /^secretlint-(disable-next-line|disable-line|disable|enable)\b([\s\S]*)$/.exec(text))) {
    const { rules, reason } = splitRulesAndReason(m[2] ?? "", false)
    return [
      {
        domain: "secretlint",
        directive: `secretlint-${m[1]}`,
        rules: rules.length > 0 ? rules : [],
        reason,
        blanket: m[1] !== "enable" && rules.length === 0,
        closing: m[1] === "enable",
      },
    ]
  }

  return []
}

/**
 * Pulls markdownlint directives out of a Markdown file's HTML comments.
 * @param {string} text
 * @returns {{ line: number, body: string }[]}
 */
function markdownComments(text) {
  const found = []
  const pattern = /<!--([\s\S]*?)-->/g
  let m
  while ((m = pattern.exec(text)) !== null) {
    const line = text.slice(0, m.index).split("\n").length
    found.push({ line, body: m[1] ?? "" })
  }
  return found
}

/**
 * @param {string} body
 * @returns {{ domain: string, directive: string, rules: string[], reason: string, blanket: boolean, closing: boolean }[]}
 */
function parseMarkdownDirective(body) {
  const text = body.trim()
  const m =
    /^markdownlint-(disable-next-line|disable-line|disable-file|disable|enable-file|enable|capture|restore|configure-file)\b([\s\S]*)$/.exec(
      text,
    )
  if (!m) return []
  if (m[1] === "capture" || m[1] === "restore" || m[1] === "configure-file") return []
  const { rules, reason } = splitRulesAndReason(m[2] ?? "", false)
  const closing = m[1] === "enable" || m[1] === "enable-file"
  return [
    {
      domain: "markdownlint",
      directive: `markdownlint-${m[1]}`,
      rules,
      reason,
      blanket: !closing && rules.length === 0,
      closing,
    },
  ]
}

/** @param {string} value @returns {string} */
function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12)
}

/**
 * The words of the contiguous line- or block-comment lines directly above `index`, directives
 * excluded -- where the reason for a directive that cannot hold one itself (a `// Stryker disable`
 * whose text sits above it) is written.
 * @param {string[]} lines
 * @param {number} index - 0-indexed line of the directive.
 * @returns {string}
 */
function blockReasonAbove(lines, index) {
  const collected = []
  for (let i = index - 1; i >= 0; i -= 1) {
    const trimmed = (lines[i] ?? "").trim()
    const comment = /^(?:\/\/+|\/\*+|\*+\/?|<!--)\s?(.*?)(?:\*\/|-->)?$/.exec(trimmed)
    if (comment === null || trimmed === "") break
    const content = (comment[1] ?? "").trim()
    if (parseDirective(content, "line").length > 0) break
    collected.unshift(content)
  }
  return squash(collected.join(" "))
}

/**
 * @param {string} file - repo-relative path, for ids.
 * @param {string} text - the file content.
 * @param {typeof import("typescript")} ts
 * @returns {Suppression[]}
 */
export function scanSource(file, text, ts) {
  const lines = text.split("\n")
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?[jt]sx?$/.test(file) && file.endsWith("x") ? ts.ScriptKind.TSX : undefined,
  )
  const seen = new Set()
  /** @type {{ pos: number, end: number, kind: "line" | "block" }[]} */
  const ranges = []
  const collect = (list) => {
    for (const range of list ?? []) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      ranges.push({
        pos: range.pos,
        end: range.end,
        kind: range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "line" : "block",
      })
    }
  }
  // Every token, punctuation included (`getChildren`, unlike `forEachChild`): a comment on the same
  // line as the token before it is that token's TRAILING comment, and a token such as the `{` of a JSX
  // expression is not a node of its own.
  const visit = (node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()))
    collect(ts.getTrailingCommentRanges(text, node.getEnd()))
    for (const child of node.getChildren(sourceFile)) visit(child)
  }
  visit(sourceFile)
  /** @type {Suppression[]} */
  const found = []
  for (const range of ranges.sort((a, b) => a.pos - b.pos)) {
    const raw = text.slice(range.pos, range.end)
    const body =
      range.kind === "line"
        ? raw.replace(/^\/\/+/, "")
        : raw.replace(/^\/\*+/, "").replace(/\*+\/$/, "")
    const line = sourceFile.getLineAndCharacterOfPosition(range.pos).line
    for (const directive of parseDirective(body, range.kind)) {
      found.push(
        toSuppression(file, lines, line, directive, range.kind === "block" ? body : undefined),
      )
    }
  }
  return found
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {Suppression[]}
 */
export function scanMarkdown(file, text) {
  const lines = text.split("\n")
  const found = []
  for (const { line, body } of markdownComments(text)) {
    for (const directive of parseMarkdownDirective(body)) {
      found.push(toSuppression(file, lines, line - 1, directive, body, false))
    }
  }
  return found
}

/**
 * @param {string} file
 * @param {string[]} lines
 * @param {number} line - 0-indexed.
 * @param {ReturnType<typeof parseDirective>[number]} directive
 * @param {string | undefined} blockBody - a block comment's full text, whose OWN other lines may hold the reason.
 * @param {boolean} [allowBlockReason] - whether the comment block above may supply the reason (not in Markdown, where the only comments are HTML directives).
 * @returns {Suppression}
 */
function toSuppression(file, lines, line, directive, blockBody, allowBlockReason = true) {
  const rule = directive.rules.length > 0 ? directive.rules.join(",") : "*"
  // A multi-line block comment can put its reason on the lines after the directive.
  let reason = directive.reason
  if (reason === "" && blockBody !== undefined) {
    const after = blockBody.split("\n").slice(1).join(" ").replace(/\*/g, " ")
    reason = squash(after)
  }
  const blockReason = reason === "" && allowBlockReason ? blockReasonAbove(lines, line) : ""
  const documented =
    reason.length >= MIN_REASON_LENGTH ||
    (directive.closing === false && blockReason.length >= MIN_BLOCK_REASON_LENGTH)
  // The code the directive covers anchors the id: the next non-comment line for a `next-line`/`next`
  // form, the line itself otherwise. Edits elsewhere in the file leave the id alone.
  const covered = directive.directive.includes("next")
    ? (lines.slice(line + 1).find((l) => l.trim() !== "" && !/^\s*(\/\/|\/\*|\*)/.test(l)) ?? "")
    : (lines[line] ?? "")
  const anchor = hash(`${directive.directive}|${rule}|${squash(covered)}`)
  return {
    id: `suppression:${directive.domain}:${rule}:${file}:${anchor}`,
    domain: directive.domain,
    rule,
    directive: directive.directive,
    file,
    line: line + 1,
    reason,
    blockReason,
    blanket: directive.blanket,
    documented,
    closing: directive.closing,
  }
}

/**
 * Every file the repository tracks (or would track) that can hold a suppression.
 * @param {string} cwd
 * @returns {string[]} repo-relative, forward-slash paths.
 */
export function listScannableFiles(cwd) {
  let files
  try {
    files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean)
  } catch {
    files = walk(cwd, "")
  }
  return files
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => {
      const ext = path.extname(f)
      if (!SOURCE_EXTENSIONS.has(ext) && !MARKDOWN_EXTENSIONS.has(ext)) return false
      if (EXCLUDED_PREFIXES.some((p) => f.startsWith(p))) return false
      if (EXCLUDED_SEGMENTS.some((s) => `/${f}`.includes(s))) return false
      return existsSync(path.join(cwd, f))
    })
    .sort()
}

/** @param {string} root @param {string} rel @returns {string[]} */
function walk(root, rel) {
  const out = []
  for (const entry of readdirSync(path.join(root, rel))) {
    if (entry === "node_modules" || entry === ".git") continue
    const next = rel === "" ? entry : `${rel}/${entry}`
    if (statSync(path.join(root, next)).isDirectory()) out.push(...walk(root, next))
    else out.push(next)
  }
  return out
}

/**
 * Scans a whole repository.
 * @param {string} cwd
 * @param {typeof import("typescript")} [tsOverride]
 * @returns {{ files: number, suppressions: Suppression[] }}
 */
export function scanRepository(cwd, tsOverride) {
  const ts = tsOverride ?? createRequire(path.join(cwd, "package.json"))("typescript")
  const files = listScannableFiles(cwd)
  const suppressions = []
  for (const file of files) {
    const text = readFileSync(path.join(cwd, file), "utf8")
    suppressions.push(
      ...(MARKDOWN_EXTENSIONS.has(path.extname(file))
        ? scanMarkdown(file, text)
        : scanSource(file, text, ts)),
    )
  }
  return { files: files.length, suppressions }
}
