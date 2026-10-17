import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

const manifest = createRequire(import.meta.url)("../package.json") as {
  exports: Record<string, string>
  dependencies: Record<string, string>
  files: string[]
}

/** Every entry of env-cap and data-cap that IPC hands on, with the package it comes from. */
const ENTRIES: readonly (readonly [string, string])[] = [
  ["env-cap", "@maverickcer/env-cap"],
  ["env-cap/build", "@maverickcer/env-cap/build"],
  ["env-cap/helpers", "@maverickcer/env-cap/helpers"],
  ["env-cap/node", "@maverickcer/env-cap/node"],
  ["env-cap/evidence", "@maverickcer/env-cap/evidence"],
  ["data-cap", "data-cap"],
  ["data-cap/runtime", "data-cap/runtime"],
  ["data-cap/runtime/cache", "data-cap/runtime/cache"],
  ["data-cap/runtime/retry", "data-cap/runtime/retry"],
  ["data-cap/helpers", "data-cap/helpers"],
  ["data-cap/build", "data-cap/build"],
  ["data-cap/node", "data-cap/node"],
  ["data-cap/evidence", "data-cap/evidence"],
]
const FILES: Record<string, () => Promise<Record<string, unknown>>> = {
  "env-cap": () => import("../reexports/env-cap/index.js"),
  "env-cap/build": () => import("../reexports/env-cap/build.js"),
  "env-cap/helpers": () => import("../reexports/env-cap/helpers.js"),
  "env-cap/node": () => import("../reexports/env-cap/node.js"),
  "env-cap/evidence": () => import("../reexports/env-cap/evidence.js"),
  "data-cap": () => import("../reexports/data-cap/index.js"),
  "data-cap/runtime": () => import("../reexports/data-cap/runtime.js"),
  "data-cap/runtime/cache": () => import("../reexports/data-cap/runtime-cache.js"),
  "data-cap/runtime/retry": () => import("../reexports/data-cap/runtime-retry.js"),
  "data-cap/helpers": () => import("../reexports/data-cap/helpers.js"),
  "data-cap/build": () => import("../reexports/data-cap/build.js"),
  "data-cap/node": () => import("../reexports/data-cap/node.js"),
  "data-cap/evidence": () => import("../reexports/data-cap/evidence.js"),
}

describe("env-cap and data-cap, handed on by this package", () => {
  it("depends on both, so a package that uses this one installs neither itself", () => {
    expect(manifest.dependencies["@maverickcer/env-cap"]).toMatch(/^\^0\./)
    expect(manifest.dependencies["data-cap"]).toMatch(/^\^0\./)
  })

  it("exports each entry point under its own path, from files it ships", () => {
    for (const [entry] of ENTRIES) {
      expect(manifest.exports[`./${entry}`], entry).toMatch(
        /^\.\/reexports\/(env-cap|data-cap)\/.+\.ts$/,
      )
    }
    expect(manifest.files).toContain("reexports")
  })

  for (const [entry, original] of ENTRIES) {
    it(`${entry} is the very module ${original} is`, async () => {
      const handedOn = await FILES[entry]!()
      const source = (await import(/* @vite-ignore */ original)) as Record<string, unknown>
      const names = Object.keys(source).filter((name) => name !== "default")
      expect(names.length).toBeGreaterThan(0)
      for (const name of names) expect(handedOn[name], name).toBe(source[name])
    })
  }
})
