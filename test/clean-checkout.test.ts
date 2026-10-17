import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanCheckoutCheck } from "../checks/clean-checkout.js"
import { checkCleanCheckout, OUTPUT_TAIL, SCRIPTS } from "../scripts/clean-checkout/run.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "clean-checkout-test-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (file: string, text: string) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), text)
}
const git = (...args: string[]) =>
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.test", ...args], { cwd: dir })
// A "type check" that fails when the file the package needs is not in the copy.
const NEEDS = "node -e \"require('node:fs').accessSync('needed.txt')\""
const manifest = (scripts: Record<string, string>) => JSON.stringify({ name: "p", scripts })

describe("checkCleanCheckout", () => {
  it("passes when everything the type check needs is tracked", () => {
    put("package.json", manifest({ typecheck: NEEDS }))
    put("needed.txt", "x")
    git("init", "-q")
    git("add", "-A")
    expect(checkCleanCheckout(dir)).toEqual({ state: "passed", output: "" })
    // The copy is where the script runs: its own folder, with a temporary name that says what it is.
    put(
      "package.json",
      manifest({ typecheck: 'node -e "console.log(process.cwd())" && node -e "process.exit(3)"' }),
    )
    git("add", "-A")
    expect(checkCleanCheckout(dir).output).toMatch(/clean-checkout-/)
  })

  it("fails when a file it needs is on disk but not tracked, which is what a clean checkout lacks", () => {
    put("package.json", manifest({ typecheck: NEEDS }))
    put(".gitignore", "needed.txt\n")
    put("needed.txt", "x")
    git("init", "-q")
    git("add", "-A")
    const result = checkCleanCheckout(dir)
    expect(result.state).toBe("failed")
    expect(result.output).toContain("needed.txt")
  })

  it("counts a file that is staged but not yet committed, as the commit will have it", () => {
    put("package.json", manifest({ typecheck: NEEDS }))
    put("needed.txt", "x")
    git("init", "-q")
    git("add", "package.json")
    expect(checkCleanCheckout(dir).state).toBe("failed")
    git("add", "needed.txt")
    expect(checkCleanCheckout(dir).state).toBe("passed")
  })

  it("links the installed dependencies so the type check can resolve them", () => {
    put("package.json", manifest({ typecheck: "node -e \"require('dep')\"" }))
    put("node_modules/dep/index.js", "module.exports = 1")
    put("node_modules/dep/package.json", '{"name":"dep","main":"index.js"}')
    put(".gitignore", "node_modules\n")
    git("init", "-q")
    git("add", "-A")
    expect(checkCleanCheckout(dir).state).toBe("passed")
  })

  it("works without an installation, and the link it makes points at this one", () => {
    put(
      "package.json",
      manifest({ typecheck: "node -e \"require('node:fs').lstatSync('node_modules')\"" }),
    )
    git("init", "-q")
    git("add", "-A")
    expect(checkCleanCheckout(dir).state).toBe("failed")
    put("node_modules/x/index.js", "1")
    put(".gitignore", "node_modules\n")
    git("add", "-A")
    expect(checkCleanCheckout(dir).state).toBe("passed")
  })

  it("looks for typecheck first and check second, and says why when there is neither", () => {
    expect(SCRIPTS).toEqual(["typecheck", "check"])
    put("package.json", manifest({ check: NEEDS, typecheck: 'node -e "process.exit(0)"' }))
    put("needed.txt", "x")
    put(".gitignore", "needed.txt\n")
    git("init", "-q")
    git("add", "-A")
    expect(checkCleanCheckout(dir).state).toBe("passed")
    put("package.json", manifest({ check: NEEDS }))
    git("add", "-A")
    expect(checkCleanCheckout(dir).state).toBe("failed")
    put("package.json", manifest({ test: "x" }))
    git("add", "-A")
    expect(checkCleanCheckout(dir)).toEqual({
      state: "skipped",
      output: "",
      reason: 'package.json has no "typecheck" or "check" script',
    })
  })

  it("is skipped when package.json has no scripts at all", () => {
    put("package.json", JSON.stringify({ name: "p" }))
    git("init", "-q")
    git("add", "-A")
    expect(checkCleanCheckout(dir).state).toBe("skipped")
  })

  it("keeps npm's own banner out of the output it reports", () => {
    put("package.json", manifest({ typecheck: "node -e \"console.log('MSG');process.exit(1)\"" }))
    git("init", "-q")
    git("add", "-A")
    const { output } = checkCleanCheckout(dir)
    expect(output).toContain("MSG")
    expect(output).not.toContain("> p@")
  })

  it("is skipped, saying so, outside a git repository", () => {
    put("package.json", manifest({ typecheck: NEEDS }))
    expect(checkCleanCheckout(dir, { tracked: () => undefined })).toEqual({
      state: "skipped",
      output: "",
      reason: "this is not a git repository",
    })
    const real = checkCleanCheckout(dir)
    expect(real.reason).toBe("this is not a git repository")
  })

  it("keeps only the end of a long failure, and does not try a tracked file that was deleted", () => {
    put("package.json", manifest({ typecheck: "x" }))
    const result = checkCleanCheckout(dir, {
      tracked: () => ["package.json", "deleted-since.ts"],
      typecheck: (_work, script) => ({
        status: 2,
        output: `${"a".repeat(OUTPUT_TAIL)}END:${script}`,
      }),
    })
    expect(result.state).toBe("failed")
    expect(result.output).toHaveLength(OUTPUT_TAIL)
    expect(result.output.endsWith("END:typecheck")).toBe(true)
    expect(
      checkCleanCheckout(dir, {
        tracked: () => ["package.json"],
        typecheck: () => ({ status: 0, output: "ignored" }),
      }),
    ).toEqual({ state: "passed", output: "" })
  })

  it("removes its copy when it is done, whatever happened", () => {
    put("package.json", manifest({ typecheck: "x" }))
    const seen: string[] = []
    const seams = (fail: boolean) => ({
      tracked: () => ["package.json"],
      typecheck: (work: string) => {
        seen.push(work)
        expect(existsSync(path.join(work, "package.json"))).toBe(true)
        if (fail) throw new Error("boom")
        return { status: 0, output: "" }
      },
    })
    checkCleanCheckout(dir, seams(false))
    expect(() => checkCleanCheckout(dir, seams(true))).toThrow("boom")
    expect(seen).toHaveLength(2)
    for (const work of seen) expect(existsSync(work)).toBe(false)
  })
})

const judge = (value: unknown) => cleanCheckoutCheck().policy(makeContext(makeJsonResult(value)))

describe("cleanCheckoutCheck (policy)", () => {
  it("runs the bundled script and asks for JSON", () => {
    const check = cleanCheckoutCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-clean-checkout\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes what type-checks, and a package it could not try, saying why", async () => {
    expect(await judge({ ok: true, state: "passed", output: "" })).toEqual({
      outcome: "pass",
      rationale: "CleanCheckout: what git tracks type-checks on its own, as CI will see it.",
    })
    expect(
      await judge({
        ok: true,
        state: "skipped",
        output: "",
        reason: "this is not a git repository",
      }),
    ).toEqual({
      outcome: "pass",
      rationale: "CleanCheckout: not tried, because this is not a git repository.",
    })
  })
  it("does not print the word undefined when a skip gave no reason", async () => {
    expect((await judge({ ok: true, state: "skipped", output: "" })).rationale).toBe(
      "CleanCheckout: not tried, because .",
    )
  })
  it("fails with the compiler's own words", async () => {
    const result = await judge({ ok: true, state: "failed", output: "a.ts(1,1): error TS2307\n\n" })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe(
      "CleanCheckout: the files git tracks do not type-check on their own, so CI and every consumer will fail where this machine passes (a file is ignored or was never added):\na.ts(1,1): error TS2307",
    )
  })
  it("fails closed on a run that did not finish or output that is not the envelope", async () => {
    const stuck = await cleanCheckoutCheck().policy(
      makeContext(makeResult({ status: "timed_out" })),
    )
    expect(stuck.rationale).toBe(
      "check-clean-checkout did not run to completion (status: timed_out).",
    )
    const bad = await cleanCheckoutCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("CleanCheckout: output could not be parsed as JSON.\noops")
  })
})
