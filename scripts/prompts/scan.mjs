// Prompts a person has not answered yet.
//
// A scaffolded document asks for the one thing only its author knows with a single-line comment:
//
//   <!-- ipc:prompt: Say who this is for and who it is not for. -->
//
// Answering means replacing the whole comment with the answer. While one is left the document still describes
// nothing, so the `PromptBlocks` check warns during development and fails when a release is being verified.
// It only ever looks for the comment; it makes no judgement of the answer.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { DOCUMENTS } from "../generate/documents.mjs"

const PROMPT = /^\s*<!-- ipc:prompt: (.+?) -->\s*$/
/** A value a scaffold left in `docs/surface.json` for its author to replace. */
const SURFACE_TODO = /^\s*"[A-Za-z]+": "TODO: (.+?)",?\s*$/
const SURFACE = "docs/surface.json"

/** Where a package keeps its decision records, in the order they are looked for. */
export const ADR_DIRECTORIES = ["specs/decisions", "docs/decisions", "docs/adr"]

/**
 * @param {string} text - a Markdown document.
 * @returns {{ line: number, text: string }[]} every prompt left in it.
 */
export function findPrompts(text) {
  return text.split("\n").flatMap((line, index) => {
    const match = PROMPT.exec(line)
    return match === null ? [] : [{ line: index + 1, text: match[1] }]
  })
}

/**
 * @param {string} text - `docs/surface.json`.
 * @returns {{ line: number, text: string }[]} every value in it that still starts with `TODO:`.
 */
export function findSurfaceTodos(text) {
  return text.split("\n").flatMap((line, index) => {
    const match = SURFACE_TODO.exec(line)
    return match === null ? [] : [{ line: index + 1, text: match[1] }]
  })
}

/**
 * @param {string} cwd - the package root.
 * @returns {string | undefined} the folder its decision records live in, relative to the root.
 */
export function adrDirectory(cwd) {
  return ADR_DIRECTORIES.find((directory) => existsSync(path.join(cwd, directory)))
}

/**
 * @param {string} cwd - the package root.
 * @returns {{ file: string, line: number, text: string }[]} the prompts left in its documents and decision records.
 */
export function scanPackage(cwd) {
  const directory = adrDirectory(cwd)
  const records =
    directory === undefined
      ? []
      : // Stryker disable next-line MethodExpression: readdir order is platform-defined; sorting only makes the output stable, which a filesystem that already lists alphabetically cannot show.
        readdirSync(path.join(cwd, directory))
          .filter((name) => name.endsWith(".md"))
          .sort()
          .map((name) => `${directory}/${name}`)
  const prompts = [
    ...DOCUMENTS.filter((file) => existsSync(path.join(cwd, file))),
    ...records,
  ].flatMap((file) =>
    findPrompts(readFileSync(path.join(cwd, file)).toString()).map((prompt) => ({
      file,
      ...prompt,
    })),
  )
  if (!existsSync(path.join(cwd, SURFACE))) return prompts
  return [
    ...prompts,
    ...findSurfaceTodos(readFileSync(path.join(cwd, SURFACE)).toString()).map((todo) => ({
      file: SURFACE,
      ...todo,
    })),
  ]
}
