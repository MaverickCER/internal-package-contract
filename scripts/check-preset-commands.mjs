// Discovers every external command this package's own checks/*.ts files spawn via a `run:`
// property -- the reconciled successor to a hand-maintained allowlist, matching repo-contract's
// own preset-commands check (`scripts/preset-commands/scan.ts`, ported here: AST-walking logic,
// no repo-contract-specific dependencies). Holds every command to a reviewed record in
// `.repo-contract/exceptions/preset-commands.json` -- checks/preset-commands.ts owns reconciling
// this script's raw findings against it.
//
// Only `checks/*.ts` (this package's own equivalent of repo-contract's `src/presets/*.ts`) is
// scanned -- these are the files whose `run:` arrays become commands spawned on a consumer's
// behalf when a consumer adopts `contract.ts`.
//
// Prints `{ ok: true, findings: [...], nonLiteral: [...] }` JSON to stdout, matching every other
// custom check's own envelope.

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as ts from "typescript"

// This package's own root -- NOT process.cwd(): for a consumer, cwd is the consumer's own repo
// (which has no checks/ directory of its own), while the files this scan must inspect are this
// package's own checks/*.ts, wherever it's actually installed (this repo's own checkout when
// self-hosting, node_modules/internal-package-contract when consumed).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

async function listCheckFiles() {
  const dir = path.join(root, "checks")
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
    .map((e) => `checks/${e.name}`)
    .sort()
}

/** Peels off `as const`, `satisfies <Type>`, and parenthesization -- none change a `run:` initializer's runtime value. */
function unwrapTypeWrapper(expr) {
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return unwrapTypeWrapper(expr.expression)
  }
  if (ts.isParenthesizedExpression(expr)) return unwrapTypeWrapper(expr.expression)
  return expr
}

function scanCheckModule(relativePath, text) {
  const sourceFile = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true)
  const commands = []
  const nonLiteral = []

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  }

  function checkRunProperty(initializer) {
    const value = unwrapTypeWrapper(initializer)

    let first
    if (ts.isArrayLiteralExpression(value)) {
      const [element] = value.elements
      first = element === undefined ? undefined : unwrapTypeWrapper(element)
    } else if (ts.isStringLiteralLike(value)) {
      first = value
    }

    if (first === undefined) {
      if (ts.isArrayLiteralExpression(value) && value.elements.length === 0) return
      nonLiteral.push({
        file: relativePath,
        line: lineOf(value),
        detail: "The run property's first token is not a statically-resolvable string literal.",
      })
      return
    }

    if (ts.isStringLiteralLike(first)) {
      const [firstToken] = first.text.trim().split(/\s+/)
      if (firstToken !== undefined && firstToken.length > 0) {
        commands.push({ command: firstToken, file: relativePath, line: lineOf(first) })
      }
      return
    }

    nonLiteral.push({
      file: relativePath,
      line: lineOf(first),
      detail: "The run array's first element is not a string literal.",
    })
  }

  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "run"
    ) {
      checkRunProperty(node.initializer)
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "run") {
      nonLiteral.push({
        file: relativePath,
        line: lineOf(node),
        detail: "The run property uses shorthand syntax; its command cannot be verified.",
      })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { commands, nonLiteral }
}

function deriveId(command) {
  return `preset-command:${command}`
}

async function scanPresetCommands() {
  const files = await listCheckFiles()
  const perFile = await Promise.all(
    files.map(async (relativePath) => {
      const text = await readFile(path.join(root, relativePath), "utf8")
      return scanCheckModule(relativePath, text)
    }),
  )

  const seen = new Set()
  const findings = []
  const nonLiteral = []
  for (const result of perFile) {
    nonLiteral.push(...result.nonLiteral)
    for (const { command, file, line } of result.commands) {
      if (seen.has(command)) continue
      seen.add(command)
      findings.push({ id: deriveId(command), command, file, line })
    }
  }
  return { findings, nonLiteral }
}

try {
  const { findings, nonLiteral } = await scanPresetCommands()
  process.stdout.write(JSON.stringify({ ok: true, findings, nonLiteral }))
  process.exitCode = 0
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: `Preset-command discovery failed: ${error.message}` }),
  )
  process.exitCode = 1
}
