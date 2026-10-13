// Entry point for `internal-package-contract mutation`: runs Stryker on what a change touched (see mutation/changed.mjs).
// Uses the package's own `stryker.config.*` when it has one, else the bundled baseline, as the `Mutation` check does.

import { sync as spawnSync } from "cross-spawn"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { run } from "./mutation/changed.mjs"
import { defaultBase } from "./report/collect.mjs"

const BUNDLED = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "stryker.config.mjs",
)
const CONFIGS = [
  "stryker.config.mjs",
  "stryker.config.js",
  "stryker.config.cjs",
  "stryker.config.json",
  "stryker.conf.mjs",
  "stryker.conf.js",
  "stryker.conf.json",
  ".stryker.conf.json",
]

for (let dir = import.meta.dirname; ;) {
  const bin = path.join(dir, "node_modules", ".bin")
  if (existsSync(bin)) process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}

/** @param {string} cwd @returns {string | undefined} the package's own Stryker config, when it has one. */
const ownConfig = (cwd) => CONFIGS.find((name) => existsSync(path.join(cwd, name)))

process.exitCode = await run(
  process.argv.slice(2),
  process.cwd(),
  { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) },
  {
    // Every mutant of the files named, whatever an earlier run recorded, under the package's own concurrency.
    spawn: (args, cwd) =>
      spawnSync(
        "stryker",
        [
          "run",
          "--force",
          "--reporters",
          "json,clear-text",
          ...(ownConfig(cwd) === undefined ? [BUNDLED] : []),
          ...args,
        ],
        { cwd, stdio: "inherit" },
      ).status,
    mutatePatterns: async (cwd) => {
      const name = ownConfig(cwd)
      const file = name === undefined ? BUNDLED : path.join(cwd, name)
      return (await import(pathToFileURL(file).href)).default.mutate ?? []
    },
    baseOf: defaultBase,
  },
)
