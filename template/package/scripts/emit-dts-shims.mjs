#!/usr/bin/env node
// Writes thin re-export shims for the .d.ts/.d.cts files tsup does not generate. Real per-file
// declarations (with working declaration maps) are emitted by `tsc -p tsconfig.build.json` into
// dist/.dts/, mirroring src/; this script points each package.json `exports` entry's filename at
// the right file inside that tree. Add an entry here for every new entry point.

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const ENTRIES = [{ name: "index", dtsPath: "./.dts/index.js" }]

for (const { name, dtsPath } of ENTRIES) {
  const shim = `export * from "${dtsPath}";\n`
  const targetPath = path.join(root, "dist", name)
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(`${targetPath}.d.ts`, shim, "utf8")
  writeFileSync(`${targetPath}.d.cts`, shim, "utf8")
  console.log(`[dts-shims] wrote dist/${name}.d.ts and dist/${name}.d.cts -> ${dtsPath}`)
}
