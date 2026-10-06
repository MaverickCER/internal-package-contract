import { describe, expect, it } from "vitest"
import { audit, auditBothTrees } from "../scripts/dev-deps-audit.mjs"

type Reply = { error?: Error & { code?: string }; stdout?: string; stderr?: string }
const recorder = (reply: (args: string[]) => Reply) => {
  const calls: { command: string; args: string[]; options: unknown }[] = []
  return {
    calls,
    spawn: (command: string, args: string[], options: object) => {
      calls.push({ command, args, options })
      return reply(args)
    },
  }
}

describe("audit()", () => {
  it("runs npm audit --json with the extra arguments before it, asking for text and a big buffer", () => {
    const r = recorder(() => ({ stdout: '{"a":1}' }))
    expect(audit(r.spawn, [])).toEqual({ value: { a: 1 } })
    expect(audit(r.spawn, ["--omit=dev"])).toEqual({ value: { a: 1 } })
    expect(r.calls.map((c) => [c.command, c.args])).toEqual([
      ["npm", ["audit", "--json"]],
      ["npm", ["audit", "--omit=dev", "--json"]],
    ])
    for (const call of r.calls)
      expect(call.options).toEqual({ encoding: "utf8", maxBuffer: 67_108_864 })
  })

  it("returns whatever JSON npm printed, whatever the exit status", () => {
    expect(audit(recorder(() => ({ stdout: "[]" })).spawn, [])).toEqual({ value: [] })
    expect(audit(recorder(() => ({ stdout: '{"vulnerabilities":{}}' })).spawn, [])).toEqual({
      value: { vulnerabilities: {} },
    })
  })

  it("reports a spawn failure with its code, or a generic one", () => {
    const withCode = Object.assign(new Error("not found"), { code: "ENOENT" })
    expect(audit(recorder(() => ({ error: withCode })).spawn, [])).toEqual({
      error: "ENOENT: not found",
    })
    expect(audit(recorder(() => ({ error: new Error("boom") })).spawn, [])).toEqual({
      error: "spawn error: boom",
    })
  })

  it("reports output that is not JSON, naming the command and showing what it printed", () => {
    expect(audit(recorder(() => ({ stdout: "oops", stderr: "npm ERR! x" })).spawn, [])).toEqual({
      error: "npm audit did not print JSON: npm ERR! x",
    })
    expect(
      audit(recorder(() => ({ stdout: "plain text", stderr: "" })).spawn, [
        "--omit=dev",
        "--json-extra",
      ]),
    ).toEqual({
      error: "npm audit --omit=dev --json-extra did not print JSON: plain text",
    })
    expect(audit(recorder(() => ({ stdout: "x" })).spawn, ["--omit=dev"])).toEqual({
      error: "npm audit --omit=dev did not print JSON: x",
    })
    expect(audit(recorder(() => ({})).spawn, [])).toEqual({
      error: "npm audit did not print JSON: ",
    })
    expect(audit(recorder(() => ({ stdout: "", stderr: "" })).spawn, [])).toEqual({
      error: "npm audit did not print JSON: ",
    })
  })

  it("shows at most 300 characters of what it printed", () => {
    const long = "e".repeat(400)
    expect(audit(recorder(() => ({ stdout: "x", stderr: long })).spawn, [])).toEqual({
      error: `npm audit did not print JSON: ${"e".repeat(300)}`,
    })
    expect(audit(recorder(() => ({ stdout: long })).spawn, [])).toEqual({
      error: `npm audit did not print JSON: ${"e".repeat(300)}`,
    })
  })
})

describe("auditBothTrees()", () => {
  it("audits the whole tree, then production only, and returns both", () => {
    const r = recorder((args) => ({
      stdout: args.includes("--omit=dev") ? '{"tree":"production"}' : '{"tree":"all"}',
    }))
    expect(auditBothTrees(r.spawn)).toEqual({
      ok: true,
      all: { tree: "all" },
      production: { tree: "production" },
    })
    expect(r.calls.map((c) => c.args)).toEqual([
      ["audit", "--json"],
      ["audit", "--omit=dev", "--json"],
    ])
  })

  it("fails with the first error, whichever audit it came from", () => {
    const bad = (args: string[]) => ({ stdout: "nope", stderr: args.join(" ") })
    expect(auditBothTrees(recorder(bad).spawn)).toEqual({
      ok: false,
      error: "npm audit did not print JSON: audit --json",
    })
    const onlyProduction = (args: string[]) =>
      args.includes("--omit=dev") ? { stdout: "nope" } : { stdout: "{}" }
    expect(auditBothTrees(recorder(onlyProduction).spawn)).toEqual({
      ok: false,
      error: "npm audit --omit=dev did not print JSON: nope",
    })
    const onlyAll = (args: string[]) =>
      args.includes("--omit=dev") ? { stdout: "{}" } : { stdout: "nope" }
    expect(auditBothTrees(recorder(onlyAll).spawn)).toEqual({
      ok: false,
      error: "npm audit did not print JSON: nope",
    })
  })
})
