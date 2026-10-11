#!/usr/bin/env node
// `internal-package-contract site`: generates a package's landing page, its one-page brief and the shared
// stylesheet and script from `docs/site.json`, so every MaverickCER site has the same structure and a fix
// to it lands once. `--check` writes nothing and fails when the committed files differ from what the
// content produces.
//
//   internal-package-contract site [--content docs/site.json] [--out docs] [--check]

import { existsSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { format, resolveConfig } from "prettier"
import { renderBrief, renderIndex } from "./render.mjs"
import { validateSite } from "./validate.mjs"

const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets")
const USAGE =
  "Usage: internal-package-contract site [--content docs/site.json] [--out docs] [--check]\n"
const PARSERS = { ".html": "html", ".css": "css", ".js": "babel" }

/**
 * @param {{ site: Record<string, unknown>, pkg: { name: string, version: string, license?: string }, outDir: string }} input
 * @returns {Promise<{ name: string, text: string }[]>} every generated file, formatted with the package's own Prettier settings.
 */
export async function renderFiles({ site, pkg, outDir }) {
  const raw = [
    ["index.html", renderIndex(site, pkg)],
    ["brief.html", renderBrief(site, pkg)],
    ["styles.css", readFileSync(path.join(assetsDir, "styles.css"), "utf8")],
    ["script.js", readFileSync(path.join(assetsDir, "script.js"), "utf8")],
  ]
  return Promise.all(
    raw.map(async ([name, text]) => {
      const file = path.join(outDir, name)
      const options = (await resolveConfig(file)) ?? {}
      return { name, text: await format(text, { ...options, parser: PARSERS[path.extname(name)] }) }
    }),
  )
}

function parseArgs(argv) {
  const args = { content: "docs/site.json", out: "docs", check: false, errors: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--check") args.check = true
    else if (arg === "--content" || arg === "--out") args[arg.slice(2)] = argv[(i += 1)]
    else args.errors.push(arg)
  }
  return args
}

/**
 * @param {readonly string[]} argv
 * @param {string} cwd - the package root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {Promise<number>} the exit code.
 */
export async function run(argv, cwd, io) {
  const args = parseArgs(argv)
  if (args.errors.length > 0 || !args.content || !args.out) {
    io.err(USAGE)
    return 1
  }
  const contentPath = path.resolve(cwd, args.content)
  if (!existsSync(contentPath)) {
    io.err(`[site] ${args.content} not found. Create it to describe this package's landing page.\n`)
    return 1
  }
  let site
  try {
    site = JSON.parse(readFileSync(contentPath, "utf8"))
  } catch {
    io.err(`[site] ${args.content} is not valid JSON.\n`)
    return 1
  }
  const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"))
  const problems = validateSite(site, pkg)
  if (problems.length > 0) {
    io.err(
      `[site] ${args.content} does not meet the bar:\n${problems.map((p) => `- ${p}`).join("\n")}\n`,
    )
    return 1
  }

  const outDir = path.resolve(cwd, args.out)
  const files = await renderFiles({ site, pkg, outDir })
  if (args.check) {
    const stale = files.filter(({ name }) => {
      const file = path.join(outDir, name)
      return (
        !existsSync(file) || readFileSync(file, "utf8") !== files.find((f) => f.name === name).text
      )
    })
    if (stale.length > 0) {
      io.err(
        `[site] ${args.out} is stale: ${stale.map((f) => f.name).join(", ")}. Run \`npx internal-package-contract site\` and commit the result.\n`,
      )
      return 1
    }
    io.out(`[site] ${args.out} is up to date.\n`)
    return 0
  }
  await fs.mkdir(outDir, { recursive: true })
  for (const { name, text } of files) await fs.writeFile(path.join(outDir, name), text)
  io.out(`[site] wrote ${files.map((f) => f.name).join(", ")} to ${args.out}\n`)
  return 0
}

// Stryker disable BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression, ObjectLiteral: process entry point, exercised only by spawning the script
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv.slice(2), process.cwd(), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  }).then((code) => {
    process.exitCode = code
  })
}
// Stryker restore BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression, ObjectLiteral
