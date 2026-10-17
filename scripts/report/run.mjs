// `internal-package-contract report`: what this change does to the package, as Markdown to paste into a pull request.

import { writeFileSync } from "node:fs"
import path from "node:path"

import { collect, defaultBase } from "./collect.mjs"
import { render } from "./render.mjs"

const USAGE = "Usage: internal-package-contract report [--base <ref>] [--out <file>]\n"

/**
 * @param {string[]} argv - the arguments after the command.
 * @param {string} cwd - the package.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io) {
  /** @type {string | undefined} */
  let base
  /** @type {string | undefined} */
  let out
  let reading
  for (const arg of argv) {
    if (reading === "base") {
      base = arg
      reading = undefined
    } else if (reading === "out") {
      out = arg
      reading = undefined
    } else if (arg === "--base") reading = "base"
    else if (arg === "--out") reading = "out"
    else {
      io.err(`report: unknown argument ${arg}.\n${USAGE}`)
      return 1
    }
  }
  if (reading !== undefined) {
    io.err(`report: --${reading} needs a value.\n${USAGE}`)
    return 1
  }
  const against = base ?? defaultBase(cwd)
  if (against === undefined) {
    io.err(
      "report: no base to measure against (no origin/main or main); give one with --base <ref>.\n",
    )
    return 1
  }
  const text = render(collect(cwd, against))
  if (out === undefined) io.out(text)
  else {
    writeFileSync(path.resolve(cwd, out), text)
    io.out(`[report] wrote ${out}\n`)
  }
  return 0
}
