// Entry point for the `NoMinify` check (see checks/no-minify.ts).
//
// Minified code is a Socket.dev supply-chain alert ("minified file"), and 0 minification is allowed
// across this organization's packages. Two independent layers, both fail-closed:
//   1. Config: no `minify*` option (other than `false`) in a tsup config, and no `--minify*` flag
//      in a package.json script -- catches the intent before a build even runs.
//   2. Output: no shipped `.js/.cjs/.mjs` file in the build directory that looks minified (a line
//      over MAX_LINE_LENGTH characters, or -- for files of at least MEAN_MIN_BYTES -- an average
//      non-empty line length over MAX_MEAN_LINE_LENGTH). esbuild's `minifyWhitespace` alone
//      trips both. Sourcemaps and declaration files are not code and are not inspected here.
//
// Prints one JSON envelope to stdout; never exits non-zero for a finding (policy decides).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const MAX_LINE_LENGTH = 5000
const MAX_MEAN_LINE_LENGTH = 120
const MEAN_MIN_BYTES = 1000
const CODE_EXTENSIONS = new Set([".js", ".cjs", ".mjs"])
const TSUP_CONFIGS = ["ts", "mts", "cts", "js", "mjs", "cjs"].map((ext) => `tsup.config.${ext}`)
const MINIFY_OPTION = /\bminify(?:Whitespace|Identifiers|Syntax)?\s*(?::|=(?!=))\s*(?!false\b)\S/
const MINIFY_FLAG = /(?:^|\s)--minify(?:-whitespace|-identifiers|-syntax)?(?:\s|=|$)(?!=?false)/

const dir = process.argv[2] ?? "dist"
const root = process.cwd()

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.isFile() ? [full] : []
    })
}

function configFindings() {
  const findings = []
  for (const name of TSUP_CONFIGS) {
    const file = path.join(root, name)
    if (!existsSync(file)) continue
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, index) => {
        const code = text.replace(/\/\/.*$/, "")
        if (MINIFY_OPTION.test(code))
          findings.push({ file: name, line: index + 1, text: text.trim() })
      })
  }
  const pkgFile = path.join(root, "package.json")
  if (existsSync(pkgFile)) {
    const scripts = JSON.parse(readFileSync(pkgFile, "utf8")).scripts ?? {}
    for (const [script, command] of Object.entries(scripts)) {
      if (typeof command === "string" && MINIFY_FLAG.test(command)) {
        findings.push({ file: "package.json", line: 0, text: `scripts.${script}: ${command}` })
      }
    }
  }
  return findings
}

function outputFindings(directory) {
  const findings = []
  for (const file of walk(directory)) {
    if (!CODE_EXTENSIONS.has(path.extname(file))) continue
    const content = readFileSync(file, "utf8")
    const lines = content.split("\n")
    const relative = path.relative(directory, file).split(path.sep).join("/")
    const longest = Math.max(...lines.map((line) => line.length))
    if (longest > MAX_LINE_LENGTH) {
      findings.push({
        file: relative,
        reason: `a line is ${longest} characters long (limit ${MAX_LINE_LENGTH})`,
      })
      continue
    }
    const nonEmpty = lines.filter((line) => line.trim() !== "")
    const mean = nonEmpty.reduce((sum, line) => sum + line.length, 0) / Math.max(nonEmpty.length, 1)
    if (statSync(file).size >= MEAN_MIN_BYTES && mean > MAX_MEAN_LINE_LENGTH) {
      findings.push({
        file: relative,
        reason: `average line length is ${Math.round(mean)} characters (limit ${MAX_MEAN_LINE_LENGTH})`,
      })
    }
  }
  return findings
}

const target = path.resolve(root, dir)
const dirExists = existsSync(target) && statSync(target).isDirectory()
process.stdout.write(
  JSON.stringify({
    ok: true,
    dirExists,
    config: configFindings(),
    output: dirExists ? outputFindings(target) : [],
  }),
)
