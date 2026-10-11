import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { engineMatrixCheck } from "../checks/engine-matrix.js"
import {
  judgeEngineMatrix,
  minimumNodeMajor,
  testedVersions,
} from "../scripts/engines/validate.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

describe("minimumNodeMajor", () => {
  it("reads the lowest major a range allows", () => {
    expect(minimumNodeMajor(">=22.0.0")).toBe(22)
    expect(minimumNodeMajor(">=22")).toBe(22)
    expect(minimumNodeMajor("^22.4.1")).toBe(22)
    expect(minimumNodeMajor("~20.1")).toBe(20)
    expect(minimumNodeMajor("22.x")).toBe(22)
    expect(minimumNodeMajor("22")).toBe(22)
    expect(minimumNodeMajor("v22.0.0")).toBe(22)
    expect(minimumNodeMajor(">=22 <25")).toBe(22)
    expect(minimumNodeMajor("18 || 20 || 22")).toBe(18)
    expect(minimumNodeMajor("22.*")).toBe(22)
  })
  it("has no answer for anything it cannot read", () => {
    expect(minimumNodeMajor("lts")).toBeUndefined()
    expect(minimumNodeMajor("")).toBeUndefined()
    expect(minimumNodeMajor(22)).toBeUndefined()
    expect(minimumNodeMajor(undefined)).toBeUndefined()
  })
})

describe("testedVersions", () => {
  it("reads a single value and strips quotes and comments", () => {
    expect(testedVersions("        node-version: 22.x")).toEqual(["22.x"])
    expect(testedVersions('node-version: "24"')).toEqual(["24"])
    expect(testedVersions("node-version: 20 # the floor")).toEqual(["20"])
  })
  it("reads an inline matrix list", () => {
    expect(testedVersions("node-version: [22.x, 24.x]")).toEqual(["22.x", "24.x"])
    expect(testedVersions("node-version: ['20', '22']")).toEqual(["20", "22"])
  })
  it("reads a block list that follows the key, and stops at the first non-item", () => {
    const text = "node-version:\n  - 20.x\n  - '22.x'\nos: [ubuntu]\n  - 99"
    expect(testedVersions(text)).toEqual(["20.x", "22.x"])
  })
  it("ignores other keys, including node-version-file, and finds each occurrence", () => {
    expect(testedVersions("node-version-file: .nvmrc\nother: 22")).toEqual([])
    expect(testedVersions("node-version: 20\nsteps:\nnode-version: 22")).toEqual(["20", "22"])
    expect(testedVersions("")).toEqual([])
  })
})

describe("judgeEngineMatrix", () => {
  const wf = (version: string) => `node-version: ${version}`
  it("passes when a workflow tests the declared minimum, reporting every tested major", () => {
    expect(judgeEngineMatrix({ engines: { node: ">=22" } }, [wf("22.x"), wf("24.x")])).toEqual({
      state: "ok",
      minimum: 22,
      tested: [22, 24],
    })
  })
  it("reads versions in any of the forms a workflow uses", () => {
    for (const form of ["22", "22.x", "22.4.1", "v22", "22.*"]) {
      expect(judgeEngineMatrix({ engines: { node: ">=22" } }, [wf(form)]).state).toBe("ok")
    }
  })
  it("fails when only newer versions are tested", () => {
    expect(judgeEngineMatrix({ engines: { node: ">=22" } }, [wf("24.x")])).toEqual({
      state: "untested",
      minimum: 22,
      tested: [24],
    })
    expect(judgeEngineMatrix({ engines: { node: ">=22" } }, [])).toEqual({
      state: "untested",
      minimum: 22,
      tested: [],
    })
  })
  it("does not count a version that is not a Node major", () => {
    expect(
      judgeEngineMatrix({ engines: { node: ">=22" } }, [wf("lts/*"), wf("${{ matrix.node }}")])
        .state,
    ).toBe("untested")
    expect(judgeEngineMatrix({ engines: { node: ">=22" } }, [wf("122.x")]).state).toBe("untested")
  })
  it("reports a missing or unreadable declaration", () => {
    expect(judgeEngineMatrix({}, [])).toEqual({ state: "no-engines" })
    expect(judgeEngineMatrix({ engines: {} }, [])).toEqual({ state: "no-engines" })
    expect(judgeEngineMatrix({ engines: { node: "lts" } }, [])).toEqual({ state: "unreadable" })
  })
})

const judge = (value: unknown) => engineMatrixCheck().policy(makeContext(makeJsonResult(value)))

describe("engineMatrixCheck (policy)", () => {
  it("runs the bundled script and asks for JSON", () => {
    const check = engineMatrixCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-engines\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes a private package and a tested minimum, saying so", async () => {
    expect(await judge({ ok: true, state: "exempt" })).toEqual({
      outcome: "pass",
      rationale: "EngineMatrix: this package is private, so it promises no Node.js version.",
    })
    expect(await judge({ ok: true, state: "ok", minimum: 22, tested: [22, 24] })).toEqual({
      outcome: "pass",
      rationale:
        "EngineMatrix: a workflow tests the declared minimum, Node.js 22 (tested: 22, 24).",
    })
  })
  it("fails a missing, unreadable or untested minimum with what to do", async () => {
    expect((await judge({ ok: true, state: "no-engines" })).rationale).toBe(
      'EngineMatrix: package.json declares no `engines.node`, so there is no supported minimum to test. Add one, for example "node": ">=22".',
    )
    expect((await judge({ ok: true, state: "unreadable" })).rationale).toBe(
      "EngineMatrix: `engines.node` is not a range this check can read a minimum from. Use a form such as `>=22`, `^22` or `22.x`.",
    )
    expect(await judge({ ok: true, state: "untested", minimum: 22, tested: [24, 26] })).toEqual({
      outcome: "fail",
      rationale:
        "EngineMatrix: package.json promises Node.js 22 and up, but no workflow runs on Node.js 22 (workflows test: 24, 26). Add it to a test job's `node-version`.",
    })
    expect((await judge({ ok: true, state: "untested", minimum: 22 })).rationale).toContain(
      "(workflows test: none)",
    )
  })
  it("fails closed on output that is not the envelope or a run that did not finish", async () => {
    const bad = await engineMatrixCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("EngineMatrix: output could not be parsed as JSON.\noops")
    const stuck = await engineMatrixCheck().policy(makeContext(makeResult({ status: "timed_out" })))
    expect(stuck.rationale).toBe("check-engines did not run to completion (status: timed_out).")
  })
})

describe("check-engines (script)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-engines-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const script = path.resolve(import.meta.dirname, "../scripts/check-engines.mjs")
  const envelope = () =>
    JSON.parse(spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }).stdout)
  const manifest = (value: unknown) =>
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(value))
  const workflow = (name: string, text: string) => {
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    writeFileSync(path.join(dir, ".github", "workflows", name), text)
  }

  it("exempts a private package", () => {
    manifest({ private: true })
    expect(envelope()).toEqual({ ok: true, state: "exempt" })
  })
  it("treats a missing package.json as a package that declares nothing", () => {
    expect(envelope()).toEqual({ ok: true, state: "no-engines" })
  })
  it("reads yml and yaml workflows and ignores other files", () => {
    manifest({ engines: { node: ">=22" } })
    workflow("notes.txt", "node-version: 22")
    expect(envelope()).toMatchObject({ state: "untested", tested: [] })
    workflow("ci.yml", "node-version: 24.x")
    workflow("extra.yaml", "node-version: [22.x]")
    expect(envelope()).toEqual({ ok: true, state: "ok", minimum: 22, tested: [22, 24] })
  })
})

describe("EngineMatrix -- exact results and line reading", () => {
  it("fails with a fail outcome for a missing or unreadable minimum", async () => {
    expect((await judge({ ok: true, state: "no-engines" })).outcome).toBe("fail")
    expect((await judge({ ok: true, state: "unreadable" })).outcome).toBe("fail")
  })
  it("reads a key at any indentation, with or without spaces around the colon", () => {
    expect(testedVersions("node-version:22")).toEqual(["22"])
    expect(testedVersions("\t    node-version :   22")).toEqual(["22"])
    expect(testedVersions("node-version:\t22")).toEqual(["22"])
  })
  it("ignores a key that only ends in node-version, or has a suffix", () => {
    expect(testedVersions("other-node-version: 22")).toEqual([])
    expect(testedVersions("xnode-version: 22")).toEqual([])
    expect(testedVersions("node-versions: 22")).toEqual([])
  })
  it("cuts a comment off a value, and keeps a # inside the text before it", () => {
    expect(testedVersions("node-version: 22 #comment")).toEqual(["22"])
    expect(testedVersions("node-version: 22#x")).toEqual(["22"])
    expect(testedVersions("node-version: # only a comment\n  - 20")).toEqual(["20"])
  })
  it("trims each inline entry and drops empty ones", () => {
    expect(testedVersions("node-version: [ 22.x ,  24.x , ]")).toEqual(["22.x", "24.x"])
    expect(testedVersions("node-version: 22,,24")).toEqual(["22", "24"])
  })
  it("reads block list items with any spacing and stops at a line that is not one", () => {
    expect(testedVersions("node-version:\n-22\n  -   24  \n\t- 26")).toEqual(["22", "24", "26"])
    expect(testedVersions("node-version:\n  - 22\nrun: echo - 99")).toEqual(["22"])
    expect(testedVersions("node-version:\n  - \"22\"\n  - '24'")).toEqual(["22", "24"])
    expect(testedVersions("node-version:\n  -  \n  - 24")).toEqual(["24"])
  })
  it("reports tested majors sorted and without duplicates, ignoring what is not a Node major", () => {
    const manifest = { engines: { node: ">=22" } }
    expect(
      judgeEngineMatrix(manifest, [
        "node-version: [26.x, 22.x, 24.x, 22.x]",
        "node-version: lts/*",
      ]),
    ).toEqual({ state: "ok", minimum: 22, tested: [22, 24, 26] })
    expect(judgeEngineMatrix(manifest, ["node-version: lts/*", "node-version: x"])).toEqual({
      state: "untested",
      minimum: 22,
      tested: [],
    })
    expect(judgeEngineMatrix(manifest, ["node-version: 9, 100, 22"]).tested).toEqual([9, 22, 100])
  })
  it("matches a version only at its start, so a major cannot hide inside another number", () => {
    expect(judgeEngineMatrix({ engines: { node: ">=22" } }, ["node-version: x22"]).state).toBe(
      "untested",
    )
    expect(judgeEngineMatrix({ engines: { node: ">=22" } }, ["node-version: 22x"]).state).toBe("ok")
  })
})
