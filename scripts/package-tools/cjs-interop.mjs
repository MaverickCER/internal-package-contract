// Patches dist/eslint-plugin/index.cjs so `require("<package>/eslint-plugin")` resolves directly to the plugin
// object, matching the ESM entry point's `import plugin from "..."`.
//
// Without this, a plain CommonJS `require()` returns esbuild's raw CJS output for a module with both a default
// and a named export -- `{ default: plugin, someRule }` -- silently breaking every `eslint.config.cjs`
// consumer. tsup's own `cjsInterop` option only rewrites `module.exports` for a chunk with exactly one export
// named "default", and an entry point with two cannot use it. An esbuild footer cannot fix it either: tsup
// appends its own `exports.default = ...` assignments in a later pass, so the footer would land before the
// exports it needs to reference exist. Patching the written file is the one place that is after all of them.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const PATCH = "module.exports = Object.assign(exports.default, exports);"
const SOURCE_MAP = /\n\/\/# sourceMappingURL=[^\n]*\s*$/

/**
 * @param {string} text - the built CommonJS entry.
 * @returns {string | undefined} the entry with the interop line after its last export, or `undefined` when it
 *   has no default export to hand out.
 */
export function patchInterop(text) {
  if (!/\bexports\.default\s*=/.test(text)) return undefined
  if (text.includes(PATCH)) return text
  const map = SOURCE_MAP.exec(text)
  const body = map === null ? text.trimEnd() : text.slice(0, map.index).trimEnd()
  return `${body}\n${PATCH}${map === null ? "\n" : map[0]}`
}

/**
 * @param {readonly string[]} argv - optionally the file to patch.
 * @param {string} cwd - the package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io) {
  const relative = argv[0] ?? "dist/eslint-plugin/index.cjs"
  const target = path.join(cwd, relative)
  if (!existsSync(target)) {
    io.err(`[cjs-interop] ${relative} does not exist -- build the package first.\n`)
    return 1
  }
  const patched = patchInterop(readFileSync(target).toString())
  if (patched === undefined) {
    io.err(
      `[cjs-interop] ${relative} has no default export -- the bundled output shape changed, so there is nothing to hand out.\n`,
    )
    return 1
  }
  writeFileSync(target, patched)
  io.out(`[cjs-interop] patched ${relative}\n`)
  return 0
}
