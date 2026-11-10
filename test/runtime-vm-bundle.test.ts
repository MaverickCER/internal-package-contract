import { describe, expect, it } from "vitest"
import { HOST_GLOBALS, runBundleInVm } from "../runtime/vm-bundle.js"

/** An IIFE the way esbuild emits one with `--format=iife --global-name=lib`. */
const iife = (body: string) => `var lib = (() => {\n${body}\n})();\n`

describe("runBundleInVm()", () => {
  it("runs the bundle with the host globals a browser offers and returns what it exported", () => {
    const exported = runBundleInVm(
      iife(`return {
        add: (a, b) => a + b,
        encoded: new TextEncoder().encode("abc").length,
        href: new URL("/x?y=1", "https://example.test").href,
        b64: btoa("hi"),
        copy: structuredClone({ k: [1] }),
        hasProcess: typeof process !== "undefined",
        hasBuffer: typeof Buffer !== "undefined",
        hasRequire: typeof require !== "undefined",
      }`),
      "lib",
    )
    expect(exported).toEqual({
      add: expect.any(Function),
      encoded: 3,
      href: "https://example.test/x?y=1",
      b64: "aGk=",
      copy: { k: [1] },
      hasProcess: false,
      hasBuffer: false,
      hasRequire: false,
    })
    expect((exported["add"] as (a: number, b: number) => number)(2, 3)).toBe(5)
  })

  it("lets a bundle that reaches for Node fail where it does, under the bundle's own name", () => {
    let failure: unknown
    try {
      runBundleInVm(iife("return { env: process.env.HOME }"), "lib")
    } catch (error) {
      failure = error
    }
    expect(String((failure as Error).message)).toMatch(/process is not defined/)
    expect(String((failure as Error).stack)).toContain("lib.bundle.js:2")
    expect(() => runBundleInVm(iife('return { b: Buffer.from("x") }'), "lib")).toThrow(
      /Buffer is not defined/,
    )
  })

  it("adds the globals the caller supplies, after the host ones", () => {
    const calls: string[] = []
    const exported = runBundleInVm(iife("return { r: fetch('u'), c: console }"), "lib", {
      globals: { fetch: (url: string) => (calls.push(url), "stubbed"), console: "mine" },
    })
    expect(exported).toEqual({ r: "stubbed", c: "mine" })
    expect(calls).toEqual(["u"])
  })

  it("refuses a bundle that assigned no object to the global, naming the build flags", () => {
    for (const body of ["var lib = 1;", "var other = {};", "var lib = null;"]) {
      expect(() => runBundleInVm(body, "lib")).toThrow(
        "the bundle assigned no object to `lib`: build it with esbuild's --format=iife --global-name=lib",
      )
    }
  })

  it("names the host globals, each of which exists in this Node", () => {
    expect([...HOST_GLOBALS]).toEqual([
      "console",
      "TextEncoder",
      "TextDecoder",
      "URL",
      "URLSearchParams",
      "atob",
      "btoa",
      "structuredClone",
      "setTimeout",
      "clearTimeout",
      "queueMicrotask",
      "crypto",
    ])
    for (const name of HOST_GLOBALS) {
      expect((globalThis as Record<string, unknown>)[name], name).toBeDefined()
    }
  })
})
