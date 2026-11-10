import path from "node:path"
import { ESLint, type Linter } from "eslint"
import { describe, expect, it } from "vitest"
import baseline from "../eslint.config.mjs"
import { NETWORK_GLOBALS, NETWORK_MODULES, moduleOf } from "../scripts/eslint/no-network.mjs"

const root = path.resolve(import.meta.dirname, "..")
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: baseline as Linter.Config[],
})

/** The `ipc/no-network` findings for `code` linted as `file`, each as `"<line>:<message>"`. */
async function findings(code: string, file = "src/a.ts"): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) })
  const fatal = result?.messages.filter((m) => m.fatal) ?? []
  expect(fatal, JSON.stringify(fatal)).toEqual([])
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === "ipc/no-network")
    .map((m) => `${String(m.line)}:${m.message}`)
}

describe("moduleOf()", () => {
  it("strips the node: scheme and any subpath, and leaves a bare name alone", () => {
    expect(moduleOf("node:dns/promises")).toBe("dns")
    expect(moduleOf("node:http")).toBe("http")
    expect(moduleOf("ws")).toBe("ws")
    expect(moduleOf("undici/types")).toBe("undici")
    expect(moduleOf("./http")).toBe(".")
  })
})

describe("the baseline's ipc/no-network rule", () => {
  it("names the network modules and globals it watches for", () => {
    expect([...NETWORK_MODULES]).toEqual([
      "http",
      "https",
      "http2",
      "net",
      "tls",
      "dns",
      "dgram",
      "undici",
      "ws",
    ])
    expect([...NETWORK_GLOBALS]).toEqual([
      "fetch",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "navigator",
    ])
  })

  it("reports every way of loading a network module, with the specifier as written", async () => {
    const code = [
      'import http from "node:http"',
      'import { Agent } from "https"',
      'export { x } from "node:dns/promises"',
      'export * from "undici"',
      'const ws = await import("ws")',
      'const net = require("node:net")',
      'export * as dgram from "dgram"',
      "export const u = { http, Agent, ws, net }",
    ].join("\n")
    expect(await findings(code)).toEqual([
      "1:`node:http` opens a network connection, and library source never does: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
      "2:`https` opens a network connection, and library source never does: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
      "3:`node:dns/promises` opens a network connection, and library source never does: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
      "4:`undici` opens a network connection, and library source never does: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
      "5:`ws` opens a network connection, and library source never does: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
      "6:`node:net` opens a network connection, and library source never does: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
      "7:`dgram` opens a network connection, and library source never does: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
    ])
  })

  it("allows type-only imports and exports, relative paths that merely look alike, and other modules", async () => {
    const code = [
      'import type { Agent } from "node:http"',
      'export type { Server } from "https"',
      'export type * from "node:net"',
      'import { helper } from "./http"',
      'import fs from "node:fs"',
      'import { x } from "@scope/ws"',
      "const dyn = await import(someVariable)",
      "const tpl = await import(`ws${someVariable}`)",
      "const none = require()",
      "const num = require(1)",
      'const named = helper("ws")',
      'const member = fs.require("ws")',
      "export const u = { helper, fs, x, dyn, tpl, none, num, named, member }",
      "declare const someVariable: string",
      "export type A = Agent",
    ].join("\n")
    expect(await findings(code)).toEqual([])
  })

  it("reports a network global, bare or through globalThis, window, self or global", async () => {
    const code = [
      "export const a = fetch",
      "export const b = typeof XMLHttpRequest",
      "export const c = globalThis.WebSocket",
      "export const d = window.EventSource",
      "export const e = self.navigator",
      "export const f = global.fetch",
      "export const g = navigator.sendBeacon",
    ].join("\n")
    const found = await findings(code)
    expect(found.map((f) => f.split(":")[0])).toEqual(["1", "2", "3", "4", "5", "6", "7"])
    expect(found[0]).toBe(
      "1:`fetch` is a network global, and library source never uses one: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
    )
    expect(found[2]).toContain("`globalThis.WebSocket` is a network global")
    expect(found[6]).toContain("`navigator` is a network global")
  })

  it("does not report a local binding that shadows a global, a property of some other object, or a computed member", async () => {
    const code = [
      "export function run(fetch: () => void) { fetch() }",
      "const WebSocket = 1",
      "export const w = WebSocket",
      "export const p = (client: { fetch: () => void }) => client.fetch()",
      'export const q = globalThis["fetch"]',
      "const fetch = 1",
      "export const r = globalThis[fetch]",
      "export const s = { fetch: 1 }.fetch",
    ].join("\n")
    expect(await findings(code)).toEqual([])
  })

  it("applies to src/ only: the same code elsewhere is the package's own business", async () => {
    const code = 'import http from "node:http"\nexport const x = { http, f: fetch }\n'
    expect(await findings(code, "src/deep/b.mjs")).toHaveLength(2)
    expect(await findings(code, "scripts/b.ts")).toEqual([])
    expect(await findings(code, "bin/b.mjs")).toEqual([])
  })
})
