// Discovers every ESLint/TypeScript/Stryker suppression-directive comment (eslint-disable,
// TypeScript's own ignore/expect-error/nocheck directives, Stryker disable) across this package's
// own governed source, using the TypeScript compiler's own scanner rather than a hand-rolled
// comment parser or
// shelling out to ESLint itself -- this check must be able to audit a suppression that caused
// ESLint to be bypassed, so it can't depend on ESLint running successfully. Ported from
// repo-contract's own scripts/suppression-governance/{find-source-files,canonicalize-comment,
// recognizers,discover-suppressions}.ts (pure logic, no repo-contract-specific dependencies), with
// its own file-discovery -> registry-reconciliation split preserved:
// checks/suppression-governance.ts (the CheckDefinitionConfig, spawning this script) owns
// reconciling the findings this script prints against `.repo-contract/exceptions/suppressions.json`
// -- this script only ever discovers and prints, it never touches the registry.
//
// Prints `{ ok: true, findings: [...] }` JSON to stdout, matching every other custom check's own
// envelope (see checks/shared.ts's parseToolEnvelope). `ok: false` means discovery itself failed
// (an unreadable source file) -- distinct from "discovery succeeded and found suppressions the
// check's own policy will go on to evaluate."

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import * as ts from "typescript"

// -- find-source-files: which directories/files this check considers governed source --

const EXCLUDED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "dist",
  "coverage",
  "reports",
  ".stryker-tmp",
  ".git",
  ".repo-contract",
  "template", // consumer-facing scaffold templates, not this package's own governed source
])
const EXCLUDED_DIRECTORY_LEAF_NAMES = new Set(["fixtures"])
const INCLUDED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]

function isExcludedDirectory(name) {
  const lowerName = name.toLowerCase()
  return EXCLUDED_DIRECTORY_NAMES.has(lowerName) || EXCLUDED_DIRECTORY_LEAF_NAMES.has(lowerName)
}

function hasIncludedExtension(name) {
  const lowerName = name.toLowerCase()
  return INCLUDED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
}

function toPosixPath(relativePath) {
  return relativePath.split(path.win32.sep).join(path.posix.sep)
}

function toPosixRelative(root, absolutePath) {
  return toPosixPath(path.relative(root, absolutePath))
}

async function walk(root, dir, out) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const absolutePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (isExcludedDirectory(entry.name)) continue
      await walk(root, absolutePath, out)
      continue
    }
    if (entry.isFile() && hasIncludedExtension(entry.name)) {
      out.push(toPosixRelative(root, absolutePath))
    }
  }
}

async function listSourceFiles(root) {
  const out = []
  await walk(root, root, out)
  return out.sort()
}

// -- canonicalize-comment: strip decorative comment syntax to bare semantic content --

function stripBlockDecoration(body) {
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim()
      return trimmed.startsWith("*") ? trimmed.slice(1).trim() : trimmed
    })
    .filter((line) => line.length > 0)
    .join(" ")
}

function canonicalizeComment(rawText, kind) {
  if (kind === "single") {
    return rawText.replace(/^\/\//, "").trim()
  }
  const withoutOpen = rawText.slice(2)
  const body = withoutOpen.endsWith("*/") ? withoutOpen.slice(0, -2) : withoutOpen
  return stripBlockDecoration(body)
}

// -- recognizers: classify a comment's canonical content as a suppression directive --

const ESLINT_DIRECTIVE = /^eslint-disable(?:-next-line|-line)?(?:\s+|$)/
const RULE_SEPARATOR = /[\s,]+/
const DESCRIPTION_SEPARATOR = /--/

function eslintRecognizer(canonicalContent) {
  const match = ESLINT_DIRECTIVE.exec(canonicalContent)
  if (!match) return undefined
  const remainder = canonicalContent.slice(match[0].length)
  const [ruleListText = "", ...reasonParts] = remainder.split(DESCRIPTION_SEPARATOR)
  const trimmedRuleList = ruleListText.trim()
  const rule =
    trimmedRuleList.length === 0 ? ["*"] : trimmedRuleList.split(RULE_SEPARATOR).filter(Boolean)
  if (rule.length === 0) return undefined
  return { domain: "eslint", rule, reason: reasonParts.join("--").trim() }
}

const TYPESCRIPT_DIRECTIVE = /^@ts-(ignore|expect-error|nocheck)(?:[\s:]|$)/

function typescriptRecognizer(canonicalContent) {
  const match = TYPESCRIPT_DIRECTIVE.exec(canonicalContent)
  if (!match) return undefined
  const reason = canonicalContent.slice(match[0].length).trim()
  return { domain: "typescript", rule: [`@ts-${match[1]}`], reason }
}

const PRETTIER_DIRECTIVE = /^prettier-ignore(?:\s|$)/

function prettierRecognizer(canonicalContent) {
  const match = PRETTIER_DIRECTIVE.exec(canonicalContent)
  if (!match) return undefined
  const reason = canonicalContent.slice(match[0].length).trim()
  return { domain: "prettier", rule: ["prettier-ignore"], reason }
}

const STRYKER_DIRECTIVE = /^Stryker disable(?: next-line)?(?: |$)/i

function strykerRecognizer(canonicalContent) {
  const match = STRYKER_DIRECTIVE.exec(canonicalContent)
  if (!match) return undefined
  const remainder = canonicalContent.slice(match[0].length)
  const [ruleListText = "", ...reasonParts] = remainder.split(DESCRIPTION_SEPARATOR)
  const parsedRules = ruleListText.trim().split(RULE_SEPARATOR).filter(Boolean)
  const rule = parsedRules.length === 0 ? ["all"] : parsedRules
  return { domain: "stryker", rule, reason: reasonParts.join("--").trim() }
}

const RECOGNIZERS = [eslintRecognizer, typescriptRecognizer, prettierRecognizer, strykerRecognizer]

function recognizeSuppression(canonicalContent) {
  for (const recognize of RECOGNIZERS) {
    const result = recognize(canonicalContent)
    if (result) return result
  }
  return undefined
}

// -- discover-suppressions: scan one file's comment tokens via the TS compiler's own scanner --

const JSX_EXTENSIONS = new Set([".tsx", ".jsx"])

function languageVariantFor(file) {
  return JSX_EXTENSIONS.has(path.extname(file).toLowerCase())
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard
}

function discoverSuppressionsInFile(relativePath, text) {
  const sourceFile = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, false)
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    languageVariantFor(relativePath),
    text,
  )

  const found = []
  const templateBraceDepths = []
  let braceDepth = 0
  let kind = scanner.scan()

  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (kind === ts.SyntaxKind.TemplateHead) {
      templateBraceDepths.push(braceDepth)
    } else if (kind === ts.SyntaxKind.OpenBraceToken) {
      braceDepth += 1
    } else if (kind === ts.SyntaxKind.CloseBraceToken) {
      const openSubstitutionDepth = templateBraceDepths.at(-1)
      if (openSubstitutionDepth === braceDepth) {
        kind = scanner.reScanTemplateToken(false)
        if (kind === ts.SyntaxKind.TemplateTail) templateBraceDepths.pop()
        continue
      }
      braceDepth -= 1
    }

    const isComment =
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia

    if (isComment) {
      const start = scanner.getTokenStart()
      const canonicalContent = canonicalizeComment(
        scanner.getTokenText(),
        kind === ts.SyntaxKind.SingleLineCommentTrivia ? "single" : "multi",
      )
      const recognized = recognizeSuppression(canonicalContent)

      if (recognized) {
        found.push({
          file: relativePath,
          line: ts.getLineAndCharacterOfPosition(sourceFile, start).line + 1,
          domain: recognized.domain,
          rule: recognized.rule,
          content: canonicalContent,
          reason: recognized.reason,
        })
      }
    }

    kind = scanner.scan()
  }

  return found
}

async function discoverSuppressions(root, files) {
  const perFile = await Promise.all(
    files.map(async (relativePath) => {
      const text = await readFile(path.join(root, relativePath), "utf8")
      return discoverSuppressionsInFile(relativePath, text)
    }),
  )
  return perFile.flat()
}

// -- id derivation + dedup (mirrors repo-contract's check.ts's own toFindings) --

/** `suppression:<domain>:<rule.join(",")>:<file>:<line>` -- kept identical to repo-contract's own scheme for a consistent mental model across both packages. */
function deriveSuppressionId({ domain, rule, file, line }) {
  return `suppression:${domain}:${rule.join(",")}:${file}:${String(line)}`
}

function toFindings(discovered) {
  const seen = new Set()
  const findings = []
  for (const item of discovered) {
    const id = deriveSuppressionId(item)
    const identity = JSON.stringify([
      item.file,
      item.line,
      item.domain,
      item.rule,
      item.content,
      item.reason,
    ])
    if (seen.has(identity)) continue
    seen.add(identity)
    findings.push({
      id,
      domain: item.domain,
      rule: [...item.rule],
      file: item.file,
      line: item.line,
      content: item.content,
      reason: item.reason,
    })
  }
  return findings
}

const root = process.cwd()
try {
  const files = await listSourceFiles(root)
  const discovered = await discoverSuppressions(root, files)
  const findings = toFindings(discovered)
  process.stdout.write(JSON.stringify({ ok: true, findings }))
  process.exitCode = 0
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: `Suppression discovery failed: ${error.message}` }),
  )
  process.exitCode = 1
}
