import ts from "typescript"
import { describe, expect, it } from "vitest"
import { assertCompilerApi } from "../runtime/compiler-api.js"

describe("assertCompilerApi", () => {
  it("accepts the installed typescript", () => {
    expect(() => {
      assertCompilerApi("demo-pkg", ts)
    }).not.toThrow()
  })

  it("names the package, the installed version, the bundled fallback and the alias recipe when createSourceFile is missing", () => {
    expect(() => {
      assertCompilerApi("demo-pkg", { version: "7.0.2" })
    }).toThrow(
      "demo-pkg's build-time scanner needs TypeScript's classic compiler API (typescript ^5 || ^6), but the installed typescript 7.0.2 does not expose it and the bundled @typescript/typescript6 could not be loaded. Reinstall demo-pkg with its dependencies, or provide a TypeScript 6 compiler: npm install --save-dev typescript@npm:@typescript/typescript6 (this swaps your `tsc` for `tsc6`; to keep TypeScript 7's `tsc`, also add @typescript/native@npm:typescript@^7). See VERSIONING.md, 'Supported toolchain'.",
    )
  })

  it("uses the name it is given, not another package's", () => {
    expect(() => {
      assertCompilerApi("other-pkg", {})
    }).toThrow(/^other-pkg's build-time scanner.*Reinstall other-pkg with/s)
  })

  it("still explains itself when the version is unknown", () => {
    expect(() => {
      assertCompilerApi("demo-pkg", {})
    }).toThrow("the installed typescript does not expose it")
  })

  it("treats a createSourceFile that is not a function as missing", () => {
    expect(() => {
      assertCompilerApi("demo-pkg", { createSourceFile: 1 })
    }).toThrow("does not expose it")
  })
})
