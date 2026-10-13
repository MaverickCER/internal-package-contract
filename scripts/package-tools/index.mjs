// Build and release helpers that every package used to carry its own copy of. A package runs one from
// package.json as `internal-package-contract tool <name>`, from its own root.

import { run as ambient } from "./ambient.mjs"
import { run as apiReport } from "./api-report.mjs"
import { run as badges } from "./badges.mjs"
import { run as cjsInterop } from "./cjs-interop.mjs"
import { run as compilerIsolation } from "./compiler-isolation.mjs"
import { run as size } from "./size.mjs"

/** The tools, by the name a package runs them under, with what each does. */
export const TOOLS = Object.freeze({
  ambient: {
    run: ambient,
    summary:
      "fail when the package reaches what it must be handed (needs the AmbientCapabilities settings)",
  },
  "api-report": {
    run: apiReport,
    summary: "fail when docs/api-report/ is not what the code generates",
  },
  badges: {
    run: badges,
    summary: "write the coverage and size badges, and beside each a file saying what the number is",
  },
  "cjs-interop": {
    run: cjsInterop,
    summary: "make require() of the ESLint plugin return the plugin",
  },
  "compiler-isolation": {
    run: compilerIsolation,
    summary: "fail when a client entry can reach the bundled compiler",
  },
  size: {
    run: size,
    summary: "fail when an entry point is over its gzip budget (ci/size-budgets.mjs)",
  },
})

/**
 * @param {readonly string[]} argv - the tool's name, then its own arguments.
 * @param {string} cwd - the package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {Promise<number>} the exit code.
 */
export async function run(argv, cwd, io) {
  const [name, ...rest] = argv
  const tool = Object.hasOwn(TOOLS, String(name)) ? TOOLS[name] : undefined
  if (tool === undefined) {
    const known = Object.entries(TOOLS).map(
      ([key, { summary }]) => `  ${key.padEnd(20)} ${summary}`,
    )
    io.err(
      `[tool] ${name === undefined ? "name a tool" : `unknown tool: ${name}`}. Available:\n${known.join("\n")}\n`,
    )
    return 2
  }
  return tool.run(rest, cwd, io)
}
