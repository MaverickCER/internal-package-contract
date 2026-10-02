import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const script = path.resolve(__dirname, "../scripts/code-scanning-alerts.mjs")

let cwd: string
let binDir: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-code-scanning-alerts-"))
  binDir = path.join(cwd, "bin")
  mkdirSync(binDir)
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

/** A fake `gh` that answers `gh api <url>` with `pages[<page>]` (stdout) and records the URLs it was asked for. */
function installGh(pages: Record<string, string>): string {
  const calls = path.join(cwd, "gh-calls.txt")
  const body = `#!/usr/bin/env node
const fs = require("node:fs")
const url = process.argv[3]
fs.appendFileSync(${JSON.stringify(calls)}, url + "\\n")
const page = new URL("https://x/" + url).searchParams.get("page")
process.stdout.write(${JSON.stringify(pages)}[page] ?? "[]")
`
  const file = path.join(binDir, "gh")
  writeFileSync(file, body)
  chmodSync(file, 0o755)
  return calls
}

function gitRemote(url: string | undefined): void {
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd })
  if (url !== undefined) spawnSync("git", ["remote", "add", "origin", url], { cwd })
}

function run(env: Record<string, string> = {}) {
  const base: Record<string, string> = { ...(process.env as Record<string, string>) }
  delete base["CI"]
  delete base["GITHUB_ACTIONS"]
  const result = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: { ...base, PATH: `${binDir}${path.delimiter}${base["PATH"] ?? ""}`, ...env },
  })
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout) as {
    ok: boolean
    message?: string
    data: Record<string, unknown> & { alerts?: Record<string, unknown>[] }
  }
}

const raw = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  rule: { id: "js/bad-tag-filter", security_severity_level: "high", severity: "error" },
  tool: { name: "CodeQL" },
  most_recent_instance: {
    location: { path: "test/a.test.ts", start_line: 20 },
    message: { text: "A regex that cannot match." },
  },
  ...over,
})

const skipNote =
  "local-only check: it reads code-scanning alerts with your own gh login, so it does not run in CI"

describe.skipIf(process.platform === "win32")("code-scanning-alerts.mjs", () => {
  it("does nothing in CI, for either CI signal", () => {
    expect(run({ CI: "true" })).toEqual({ ok: true, data: { skipped: skipNote } })
    expect(run({ GITHUB_ACTIONS: "true" })).toEqual({ ok: true, data: { skipped: skipNote } })
  })

  it("is not fooled by a false-looking CI value", () => {
    gitRemote("https://github.com/acme/widget.git")
    installGh({ "1": "[]" })
    for (const value of ["false", "0", ""]) {
      expect(run({ CI: value }).data["repo"]).toBe("acme/widget")
    }
  })

  it("skips a directory with no GitHub remote", () => {
    gitRemote(undefined)
    const out = run()
    expect(out.ok).toBe(true)
    expect(out.data["skipped"]).toMatch(/^no GitHub remote found for /)
  })

  it("reads the open alerts and reduces each to what the policy needs", () => {
    gitRemote("git@github.com:acme/widget.git")
    const calls = installGh({ "1": JSON.stringify([raw(7)]) })
    const out = run()
    expect(out).toEqual({
      ok: true,
      data: {
        repo: "acme/widget",
        alerts: [
          {
            number: 7,
            rule: "js/bad-tag-filter",
            severity: "high",
            path: "test/a.test.ts",
            line: 20,
            tool: "CodeQL",
            message: "A regex that cannot match.",
          },
        ],
      },
    })
    expect(readFileLines(calls)).toEqual([
      "repos/acme/widget/code-scanning/alerts?state=open&per_page=100&page=1&ref=refs%2Fheads%2Fmain",
    ])
  })

  it("scopes the query to the checked-out branch, and not at all for a detached HEAD", () => {
    gitRemote("https://github.com/acme/widget")
    spawnSync("git", ["checkout", "-q", "-b", "feat/x"], { cwd })
    const calls = installGh({ "1": "[]" })
    run()
    expect(readFileLines(calls)[0]).toMatch(/&ref=refs%2Fheads%2Ffeat%2Fx$/)

    const git = (...args: string[]) =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd })
    git("commit", "-q", "--allow-empty", "-m", "c")
    git("checkout", "-q", "--detach")
    rmSync(calls)
    installGh({ "1": "[]" })
    run()
    expect(readFileLines(calls)[0]).toBe(
      "repos/acme/widget/code-scanning/alerts?state=open&per_page=100&page=1",
    )
  })

  it("falls back to the rule's own severity and to placeholders for missing fields", () => {
    gitRemote("https://github.com/acme/widget")
    installGh({
      "1": JSON.stringify([
        { number: 1, rule: { severity: "warning" } },
        { number: 2, rule: { id: "r", security_severity_level: "low", severity: "note" } },
      ]),
    })
    expect(run().data.alerts).toEqual([
      {
        number: 1,
        rule: "unknown-rule",
        severity: "warning",
        path: "",
        line: 0,
        tool: "unknown",
        message: "",
      },
      { number: 2, rule: "r", severity: "low", path: "", line: 0, tool: "unknown", message: "" },
    ])
    installGh({ "1": JSON.stringify([{ number: 3 }]) })
    expect(run().data.alerts?.[0]).toMatchObject({ rule: "unknown-rule", severity: "unknown" })
  })

  it("truncates a long message to 300 characters", () => {
    gitRemote("https://github.com/acme/widget")
    installGh({
      "1": JSON.stringify([
        raw(1, { most_recent_instance: { message: { text: "x".repeat(400) } } }),
      ]),
    })
    expect((run().data.alerts?.[0]?.["message"] as string).length).toBe(300)
  })

  it("follows pages until one is not full", () => {
    gitRemote("https://github.com/acme/widget")
    const full = Array.from({ length: 100 }, (_, i) => raw(i))
    const calls = installGh({ "1": JSON.stringify(full), "2": JSON.stringify([raw(100)]) })
    expect(run().data.alerts?.length).toBe(101)
    expect(readFileLines(calls)).toHaveLength(2)
  })

  it("stops after 20 pages even if every page is full", () => {
    gitRemote("https://github.com/acme/widget")
    const full = JSON.stringify(Array.from({ length: 100 }, (_, i) => raw(i)))
    const pages = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i + 1), full]))
    const calls = installGh(pages)
    run()
    expect(readFileLines(calls)).toHaveLength(20)
  })

  it("treats 'no analysis found' as no alerts", () => {
    gitRemote("https://github.com/acme/widget")
    installGh({ "1": JSON.stringify({ message: "no analysis found", status: "404" }) })
    expect(run().data.alerts).toEqual([])
  })

  it("skips when code scanning is not enabled", () => {
    gitRemote("https://github.com/acme/widget")
    for (const message of [
      "Advanced Security must be enabled for this repository to use code scanning.",
      "Code scanning is not enabled for this repository.",
    ]) {
      installGh({ "1": JSON.stringify({ message, status: "403" }) })
      expect(run().data["skipped"]).toBe("code scanning is not enabled for this repository")
    }
  })

  it("reports not-authenticated for a 401 or an authentication message", () => {
    gitRemote("https://github.com/acme/widget")
    installGh({ "1": JSON.stringify({ message: "Bad credentials", status: "401" }) })
    expect(run()).toEqual({
      ok: false,
      message: "Bad credentials",
      data: { kind: "not-authenticated" },
    })
    installGh({ "1": JSON.stringify({ message: "Requires authentication", status: "403" }) })
    expect(run().data["kind"]).toBe("not-authenticated")
  })

  it("reports no-access for a 403 or 404 that is not about authentication or enabling", () => {
    gitRemote("https://github.com/acme/widget")
    installGh({ "1": JSON.stringify({ message: "Resource not accessible", status: "403" }) })
    expect(run().data["kind"]).toBe("no-access")
    installGh({ "1": JSON.stringify({ message: "Not Found", status: "404" }) })
    expect(run().data["kind"]).toBe("no-access")
  })

  it("reports unreadable output, quoting what it can", () => {
    gitRemote("https://github.com/acme/widget")
    installGh({ "1": "not json at all" })
    expect(run()).toMatchObject({ ok: false, data: { kind: "unreadable" } })
    installGh({ "1": JSON.stringify({ message: "teapot", status: "418" }) })
    expect(run()).toEqual({ ok: false, message: "teapot", data: { kind: "unreadable" } })
    installGh({ "1": JSON.stringify({ status: "418" }) })
    expect(run().data["kind"]).toBe("unreadable")
  })

  it("reports gh as not installed when it cannot be spawned", () => {
    gitRemote("https://github.com/acme/widget")
    // A PATH with git (the remote lookup needs it) and nothing else, so `gh` cannot be found.
    const onlyGit = path.join(cwd, "only-git")
    mkdirSync(onlyGit)
    const git = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim()
    symlinkSync(git, path.join(onlyGit, "git"))
    const out = run({ PATH: onlyGit })
    expect(out.ok).toBe(false)
    expect(out.data["kind"]).toBe("gh-not-installed")
  })
})

function readFileLines(file: string): string[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean)
}
