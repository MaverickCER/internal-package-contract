import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { landingPageCheck } from "../checks/landing-page.js"
import { run } from "../scripts/site/render-site.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"
import { validSite } from "./support-site.js"

const judge = (value: unknown) => landingPageCheck().policy(makeContext(makeJsonResult(value)))

describe("landingPageCheck (policy)", () => {
  it("runs the bundled script and asks for JSON", () => {
    const check = landingPageCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-landing-page\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes, saying why, when the package has no site content", async () => {
    expect(await judge({ ok: true, state: "absent" })).toEqual({
      outcome: "pass",
      rationale:
        "LandingPage: no docs/site.json, so this package has no generated landing page to check.",
    })
  })
  it("passes when the generated files are current", async () => {
    expect(await judge({ ok: true, state: "current" })).toEqual({
      outcome: "pass",
      rationale: "LandingPage: docs/site.json meets the bar and the generated files are current.",
    })
  })
  it("fails with the generator's own message when the content or the files are wrong", async () => {
    const result = await judge({
      ok: true,
      state: "problem",
      message: "[site] docs is stale: index.html.",
    })
    expect(result).toEqual({
      outcome: "fail",
      rationale: "LandingPage: [site] docs is stale: index.html.",
    })
  })
  it("fails closed on output that is not the envelope", async () => {
    const result = await landingPageCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe("LandingPage: output could not be parsed as JSON.\noops")
  })
})

describe("check-landing-page (script)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-landing-"))
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "demo-pkg", version: "0.4.2", license: "MIT" }),
    )
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const script = path.resolve(import.meta.dirname, "../scripts/check-landing-page.mjs")
  const envelope = () =>
    JSON.parse(spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }).stdout)

  it("reports absent when there is no content file", () => {
    expect(envelope()).toEqual({ ok: true, state: "absent" })
  })
  it("reports problem, with the generator's message, when the files have not been generated", () => {
    mkdirSync(path.join(dir, "docs"))
    writeFileSync(path.join(dir, "docs", "site.json"), JSON.stringify(validSite()))
    const result = envelope()
    expect(result.state).toBe("problem")
    expect(result.message).toContain("docs is stale: index.html, brief.html, styles.css, script.js")
  })
  it("reports current once the files have been generated", async () => {
    mkdirSync(path.join(dir, "docs"))
    writeFileSync(path.join(dir, "docs", "site.json"), JSON.stringify(validSite()))
    await run([], dir, { out: () => {}, err: () => {} })
    expect(envelope()).toEqual({ ok: true, state: "current" })
  })
})
