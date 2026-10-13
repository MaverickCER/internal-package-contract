// Guards a package's core promise that its consumer-facing entry points stay small. The budgets are the
// package's own, in `ci/size-budgets.mjs` (a module so each raise can say why): it exports a default list of
// `{ label, file, maxGzipBytes }`. Build tooling is budgeted generously (999 KB means "do not silently
// balloon") and kept out of the runtime bundles by the tree-shaking tests instead.
//
//   size                    check every entry point against its budget
//   size --json <file>      also write the measured sizes, which the badge generator reads

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { gzipSync } from "node:zlib"

export const BUDGETS_PATH = "ci/size-budgets.mjs"

/**
 * @param {string} cwd - the package's root.
 * @returns {Promise<{ label: string, file: string, maxGzipBytes: number }[]>} the package's budgets.
 */
export async function loadBudgets(cwd) {
  const file = path.join(cwd, BUDGETS_PATH)
  if (!existsSync(file))
    throw new Error(`${BUDGETS_PATH} is missing: list each entry point's budget there.`)
  const { default: budgets } = await import(pathToFileURL(file).href)
  if (!Array.isArray(budgets))
    throw new Error(`${BUDGETS_PATH} must export a list of budgets as its default.`)
  return budgets
}

/**
 * @param {string} cwd
 * @param {{ label: string, file: string, maxGzipBytes: number }[]} budgets
 * @returns {{ label: string, file: string, gzipBytes: number | null, maxGzipBytes: number }[]}
 */
export function measure(cwd, budgets) {
  return budgets.map(({ label, file, maxGzipBytes }) => {
    const filePath = path.join(cwd, file)
    if (!existsSync(filePath)) return { label, file, gzipBytes: null, maxGzipBytes }
    return { label, file, gzipBytes: gzipSync(readFileSync(filePath)).length, maxGzipBytes }
  })
}

/**
 * @param {readonly string[]} argv
 * @param {string} cwd - the package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {Promise<number>} the exit code.
 */
export async function run(argv, cwd, io) {
  let budgets
  try {
    budgets = await loadBudgets(cwd)
  } catch (error) {
    io.err(`[size] ${error.message}\n`)
    return 1
  }
  const entries = measure(cwd, budgets)
  const widest = (key) => Math.max(...entries.map((entry) => entry[key].length))
  let failed = false
  for (const { label, file, gzipBytes, maxGzipBytes } of entries) {
    if (gzipBytes === null) {
      io.err(`[size] ${file} does not exist -- build the package first.\n`)
      failed = true
      continue
    }
    const status = gzipBytes <= maxGzipBytes ? "OK" : "OVER BUDGET"
    io.out(
      `[size] ${label.padEnd(widest("label"))} ${file.padEnd(widest("file"))} gzip=${String(gzipBytes)}B (budget ${String(maxGzipBytes)}B) ${status}\n`,
    )
    if (gzipBytes > maxGzipBytes) failed = true
  }
  if (failed) io.err("\n[size] One or more entry points exceeded their gzip budget.\n")
  else io.out("\n[size] All budgets met.\n")

  const flag = argv.indexOf("--json")
  if (flag !== -1) {
    const target = argv[flag + 1]
    if (target === undefined) {
      io.err("[size] --json requires a file path.\n")
      return 1
    }
    const outPath = path.resolve(cwd, target)
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(
      outPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2),
    )
  }
  return failed ? 1 : 0
}
