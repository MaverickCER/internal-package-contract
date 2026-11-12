// Entry point for the `NoMinify` check (see checks/no-minify.ts). Prints one JSON envelope with every
// request for minification and every shipped file that looks minified; the policy decides the verdict.
//
// Minified code is a supply-chain alert on Socket.dev, and none of it may ship. Two independent layers
// catch it. The configuration layer reads every `tsup.config.*` for a `minify*` option other than `false`,
// and every package.json script for a `--minify*` flag, so the intent is found before a build runs.
// The output layer reads every `.js`, `.cjs` and `.mjs` file under the build directory (the argument,
// `dist` by default) and flags a line longer than MAX_LINE_LENGTH, or a file of at least MEAN_MIN_BYTES
// whose non-empty lines average more than MAX_MEAN_LINE_LENGTH. Sourcemaps and declaration files are not
// code and are not read. A build directory that does not exist yields no output findings, and the
// envelope says so with `dirExists`.

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
