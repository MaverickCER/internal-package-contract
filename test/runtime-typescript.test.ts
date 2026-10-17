import { describe, expect, it } from "vitest"
import { pickCompiler, ts } from "../runtime/typescript.js"
import { assertCompilerApi } from "../runtime/compiler-api.js"

const classic = { version: "6.0.3", createSourceFile: () => "classic" }
const bundled = { version: "6.0.2", createSourceFile: () => "bundled" }
const typescript7 = { version: "7.0.2", versionMajorMinor: "7.0" }

function loader(modules: Record<string, unknown>): {
  load: (id: string) => unknown
  ids: string[]
} {
  const ids: string[] = []
  return {
    ids,
    load(id) {
      ids.push(id)
      if (!(id in modules)) {
        throw Object.assign(new Error(`Cannot find module '${id}'`), { code: "MODULE_NOT_FOUND" })
      }
      return modules[id]
    },
  }
}

describe("pickCompiler", () => {
  it("uses the consumer's typescript when it exposes the classic API, without touching the bundled one", () => {
    const { load, ids } = loader({ typescript: classic, "@typescript/typescript6": bundled })
    expect(pickCompiler(load)).toBe(classic)
    expect(ids).toEqual(["typescript"])
  })

  it("falls back to the bundled TypeScript 6 when the consumer's typescript has no classic API (TypeScript 7)", () => {
    const { load, ids } = loader({ typescript: typescript7, "@typescript/typescript6": bundled })
    expect(pickCompiler(load)).toBe(bundled)
    expect(ids).toEqual(["typescript", "@typescript/typescript6"])
  })

  it("falls back to the bundled TypeScript 6 when the consumer has no typescript installed", () => {
    const { load } = loader({ "@typescript/typescript6": bundled })
    expect(pickCompiler(load)).toBe(bundled)
  })

  it("hands back the consumer's module when neither has the API, so assertCompilerApi can explain", () => {
    const { load } = loader({ typescript: typescript7, "@typescript/typescript6": typescript7 })
    const picked = pickCompiler(load)
    expect(picked).toBe(typescript7)
    expect(() => {
      assertCompilerApi("demo-pkg", picked)
    }).toThrow(/typescript 7\.0\.2 does not expose it/)
  })

  it("hands back an empty module when nothing can be loaded at all", () => {
    const { load } = loader({})
    const picked = pickCompiler(load)
    expect(picked).toEqual({})
    expect(() => {
      assertCompilerApi("demo-pkg", picked)
    }).toThrow(/bundled @typescript\/typescript6 could not be loaded/)
  })

  it("treats ERR_MODULE_NOT_FOUND (an ESM-style miss) as not installed too", () => {
    const load = (id: string): unknown => {
      if (id === "typescript") {
        throw Object.assign(new Error("Cannot find package 'typescript' imported from /app/x.js"), {
          code: "ERR_MODULE_NOT_FOUND",
        })
      }
      return bundled
    }
    expect(pickCompiler(load)).toBe(bundled)
  })

  it("does not take a nested missing dependency of an installed typescript for typescript being absent", () => {
    const nested = Object.assign(new Error("Cannot find module 'some-inner-dependency'"), {
      code: "MODULE_NOT_FOUND",
    })
    const load = (id: string): unknown => {
      if (id === "typescript") throw nested
      return bundled
    }
    expect(() => pickCompiler(load)).toThrow(nested)
  })

  it("does not take a different module whose name merely starts with the requested one", () => {
    const other = Object.assign(new Error("Cannot find module 'typescript-extras'"), {
      code: "MODULE_NOT_FOUND",
    })
    const load = (id: string): unknown => {
      if (id === "typescript") throw other
      return bundled
    }
    expect(() => pickCompiler(load)).toThrow(other)
  })

  it("rethrows a not-found code that carries no message to match, as that exact error", () => {
    const bare = Object.assign(new Error("x"), { code: "MODULE_NOT_FOUND", message: undefined })
    let caught: unknown = "nothing was thrown"
    try {
      pickCompiler(() => {
        throw bare
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(bare)
  })

  it("matches Node's real not-found message, which continues with the require stack", () => {
    const load = (id: string): unknown => {
      if (id === "typescript") {
        throw Object.assign(
          new Error(
            "Cannot find module 'typescript'\nRequire stack:\n- /app/node_modules/x/index.js",
          ),
          { code: "MODULE_NOT_FOUND" },
        )
      }
      return bundled
    }
    expect(pickCompiler(load)).toBe(bundled)
  })

  it("rethrows an error that has the right message but a different code", () => {
    const denied = Object.assign(new Error("Cannot find module 'typescript'"), { code: "EACCES" })
    let caught: unknown = "nothing was thrown"
    try {
      pickCompiler((id) => {
        if (id === "typescript") throw denied
        return bundled
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(denied)
  })

  it("applies the same check to the bundled compiler", () => {
    const nested = Object.assign(new Error("Cannot find module 'inner'"), {
      code: "MODULE_NOT_FOUND",
    })
    const load = (id: string): unknown => {
      if (id === "typescript") return typescript7
      throw nested
    }
    expect(() => pickCompiler(load)).toThrow(nested)
  })

  it("rethrows a load failure that is not 'not installed' instead of masking it with the fallback", () => {
    const broken = new Error("Unexpected token in typescript.js")
    const load = (id: string): unknown => {
      if (id === "typescript") throw broken
      return bundled
    }
    expect(() => pickCompiler(load)).toThrow(broken)
  })

  it("rethrows a failure that carries a different error code", () => {
    const denied = Object.assign(new Error("denied"), { code: "EACCES" })
    expect(() =>
      pickCompiler(() => {
        throw denied
      }),
    ).toThrow(denied)
  })

  it("rethrows a thrown null as-is rather than failing while inspecting it", () => {
    const thrown: unknown = null
    let caught: unknown = "nothing was thrown"
    try {
      pickCompiler(() => {
        throw thrown
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeNull()
  })

  it("does not mistake a null or non-object module for a compiler", () => {
    const { load } = loader({ typescript: null, "@typescript/typescript6": bundled })
    expect(pickCompiler(load)).toBe(bundled)
  })

  it("rejects a createSourceFile that is not a function", () => {
    const { load } = loader({
      typescript: { createSourceFile: "nope" },
      "@typescript/typescript6": bundled,
    })
    expect(pickCompiler(load)).toBe(bundled)
  })
})

describe("the resolved compiler", () => {
  it("exposes the classic API the scanner needs", () => {
    expect(typeof ts.createSourceFile).toBe("function")
  })
})
