import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const script = path.resolve(__dirname, "../scripts/socket-package-score.mjs")
const fixture = readFileSync(
  path.join(__dirname, "fixtures/socket-score-data-cap-0.4.0.json"),
  "utf8",
)

/** A fake `socket`/`npm` pair on PATH, driven by a JSON config: `{ socket: { "<name>@<version>": <stdout> }, npm: <stdout>, npmExit?: n }`. */
function installFakes(binDir: string, config: unknown): void {
  mkdirSync(binDir, { recursive: true })
  const cfgPath = path.join(binDir, "cfg.json")
  writeFileSync(cfgPath, JSON.stringify(config))
  const socket = `#!/usr/bin/env node
const cfg = JSON.parse(require("node:fs").readFileSync(${JSON.stringify(cfgPath)}, "utf8"))
const key = "npm/" + process.argv[5]
const calls = (cfg.calls = cfg.calls ?? {})
calls[key] = (calls[key] ?? 0) + 1
require("node:fs").writeFileSync(${JSON.stringify(cfgPath)}, JSON.stringify(cfg))
const entry = cfg.socket[key]
const out = Array.isArray(entry) ? entry[Math.min(calls[key] - 1, entry.length - 1)] : entry
process.stdout.write(out ?? "")
`
  const npm = `#!/usr/bin/env node
const cfg = JSON.parse(require("node:fs").readFileSync(${JSON.stringify(cfgPath)}, "utf8"))
process.stdout.write((cfg.npmFor ?? {})[process.argv[3]] ?? cfg.npm ?? "")
process.exit(cfg.npmExit ?? 0)
`
  for (const [name, body] of [
    ["socket", socket],
    ["npm", npm],
  ] as const) {
    const file = path.join(binDir, name)
    writeFileSync(file, body)
    chmodSync(file, 0o755)
  }
}

let cwd: string
let binDir: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-socket-score-"))
  binDir = path.join(cwd, "bin")
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

function run(
  pkg: unknown,
  config: unknown,
  pathOverride?: string,
  extraEnv: Record<string, string> = {},
): { readonly out: ScoreOutput; readonly calls: Record<string, number> } {
  if (pkg !== undefined) writeFileSync(path.join(cwd, "package.json"), JSON.stringify(pkg))
  if (config !== undefined) installFakes(binDir, config)
  const result = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: pathOverride ?? `${binDir}${path.delimiter}${process.env["PATH"] ?? ""}`,
      SOCKET_SCORE_RETRY_WAIT_MS: "1",
      IPC_SOCKET_CACHE_DIR: path.join(cwd, "score-cache"),
      ...extraEnv,
    },
  })
  expect(result.status).toBe(0)
  const cfgPath = path.join(binDir, "cfg.json")
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {}
  return { out: JSON.parse(result.stdout) as ScoreOutput, calls: cfg.calls ?? {} }
}

interface ScoreOutput {
  readonly ok: boolean
  readonly message?: string
  readonly cause?: string
  readonly data: {
    readonly code?: unknown
    readonly skipped?: string
    readonly unpublished?: boolean
    readonly alerts: readonly { name: string; scope: string; example: string; category: string }[]
    readonly [key: string]: unknown
  }
}

const notFound = JSON.stringify({ ok: false, message: "Socket API error", data: { code: 404 } })

describe.skipIf(process.platform === "win32")("socket-package-score.mjs", () => {
  it("skips when there is no package.json", () => {
    const { out } = run(undefined, undefined)
    expect(out).toEqual({ ok: true, data: { skipped: "no package.json in the working directory" } })
  })

  it("skips a private or unnamed package", () => {
    const reason = "package is private or unnamed, so nothing is published"
    expect(
      run({ name: "x", version: "1.0.0", private: true }, { socket: {} }).out.data.skipped,
    ).toBe(reason)
    expect(run({ version: "1.0.0" }, { socket: {} }).out.data.skipped).toBe(reason)
    expect(run({ name: "x" }, { socket: {} }).out.data.skipped).toBe(reason)
  })

  it("flattens the package's own and transitive alerts from a real captured score", () => {
    const { out } = run(
      { name: "data-cap", version: "0.4.0" },
      { socket: { "npm/data-cap@0.4.0": fixture } },
    )
    // spawn argv: [node-script] package score npm data-cap@0.4.0 -- key is argv[5]
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({
      purl: "pkg:npm/data-cap@0.4.0",
      requestedVersion: "0.4.0",
      scoredVersion: "0.4.0",
    })
    const alerts = out.data.alerts as {
      name: string
      scope: string
      example: string
      category: string
    }[]
    expect(alerts.find((a) => a.name === "urlStrings" && a.scope === "self")).toMatchObject({
      example: "npm/data-cap@0.4.0",
      category: "supplyChainRisk",
    })
    expect(alerts.find((a) => a.name === "shellAccess")).toMatchObject({
      scope: "transitive",
      example: "npm/cross-spawn@7.0.6",
    })
    expect(alerts.find((a) => a.name === "gptDidYouMean")?.example).toBe("npm/hashery@1.5.1")
    expect(alerts.find((a) => a.name === "usesEval")?.example).toBe("npm/ajv@6.15.0")
  })

  it("tolerates a score with no self or transitive section", () => {
    const body = JSON.stringify({ ok: true, data: { purl: "p" } })
    const { out } = run({ name: "a", version: "1.0.0" }, { socket: { "npm/a@1.0.0": body } })
    expect(out.data.alerts).toEqual([])
    const noData = run(
      { name: "a", version: "1.0.0" },
      { socket: { "npm/a@1.0.0": JSON.stringify({ ok: true }) } },
    )
    expect(noData.out.data.alerts).toEqual([])
  })

  it("falls back to the latest published version when this one is unknown to Socket", () => {
    const { out } = run(
      { name: "data-cap", version: "9.9.9" },
      { socket: { "npm/data-cap@9.9.9": notFound, "npm/data-cap@0.4.0": fixture }, npm: '"0.4.0"' },
    )
    expect(out.data).toMatchObject({ requestedVersion: "9.9.9", scoredVersion: "0.4.0" })
  })

  it("reports an unpublished package when npm has no such package either", () => {
    const { out } = run(
      { name: "brand-new", version: "1.0.0" },
      {
        socket: { "npm/brand-new@1.0.0": notFound },
        npm: JSON.stringify({ error: { code: "E404" } }),
        npmExit: 1,
      },
    )
    expect(out).toEqual({ ok: true, data: { unpublished: true, requestedVersion: "1.0.0" } })
  })

  it("passes Socket's own failure envelope through verbatim (auth error)", () => {
    const envelope = {
      ok: false,
      message: "Auth Error",
      cause: "You need to provide an API token.",
    }
    const { out } = run(
      { name: "a", version: "1.0.0" },
      { socket: { "npm/a@1.0.0": JSON.stringify(envelope) } },
    )
    expect(out).toEqual(envelope)
  })

  it("waits out HTTP 429 and succeeds on a later attempt", () => {
    const limited = JSON.stringify({ ok: false, message: "Socket API error", data: { code: 429 } })
    const { out, calls } = run(
      { name: "a", version: "1.0.0" },
      {
        socket: {
          "npm/a@1.0.0": [limited, limited, JSON.stringify({ ok: true, data: { purl: "p" } })],
        },
      },
    )
    expect(out.ok).toBe(true)
    expect(calls["npm/a@1.0.0"]).toBe(3)
  })

  it("gives up on persistent 429 after the retry budget and reports it", () => {
    const limited = JSON.stringify({ ok: false, message: "Socket API error", data: { code: 429 } })
    const { out, calls } = run(
      { name: "a", version: "1.0.0" },
      { socket: { "npm/a@1.0.0": limited } },
    )
    expect(out.data.code).toBe(429)
    expect(calls["npm/a@1.0.0"]).toBe(4)
  })

  it("reports unparseable CLI output, truncating the cause", () => {
    const { out } = run(
      { name: "a", version: "1.0.0" },
      { socket: { "npm/a@1.0.0": "x".repeat(900) } },
    )
    expect(out.message).toBe("Unparseable Output")
    expect((out.cause as string).length).toBe(500)
  })

  it("reports an empty CLI output without a cause", () => {
    const { out } = run({ name: "a", version: "1.0.0" }, { socket: { "npm/a@1.0.0": "" } })
    expect(out).toMatchObject({ ok: false, message: "Unparseable Output", cause: "" })
  })

  it("reports a missing socket CLI as an ENOENT spawn error", () => {
    const empty = path.join(cwd, "empty-bin")
    mkdirSync(empty)
    const { out } = run({ name: "a", version: "1.0.0" }, undefined, empty)
    expect(out).toMatchObject({
      ok: false,
      message: "Spawn Error",
      cause: "ENOENT",
      data: { code: "ENOENT" },
    })
  })

  describe("score cache", () => {
    const pkg = { name: "data-cap", version: "0.4.0" }
    const config = { socket: { "npm/data-cap@0.4.0": fixture }, npm: '"0.4.0"' }

    it("serves a repeat run from the cache without asking Socket again", () => {
      const first = run(pkg, config)
      expect(first.calls["npm/data-cap@0.4.0"]).toBe(1)
      expect(first.out.data["cached"]).toBeUndefined()

      const second = run(undefined, undefined)
      expect(second.calls["npm/data-cap@0.4.0"]).toBe(1)
      expect(second.out.data).toMatchObject({ cached: true, scoredVersion: "0.4.0" })
      expect(second.out.data.alerts).toEqual(first.out.data.alerts)
    })

    it("scans again once the cached entry is older than the lifetime", () => {
      run(pkg, config)
      const entry = path.join(cwd, "score-cache", "data-cap@0.4.0.json")
      const stored = JSON.parse(readFileSync(entry, "utf8"))
      writeFileSync(entry, JSON.stringify({ ...stored, savedAt: Date.now() - 25 * 3_600_000 }))
      expect(run(undefined, undefined).calls["npm/data-cap@0.4.0"]).toBe(2)
    })

    it("honors a custom lifetime in hours", () => {
      run(pkg, config)
      const entry = path.join(cwd, "score-cache", "data-cap@0.4.0.json")
      const stored = JSON.parse(readFileSync(entry, "utf8"))
      writeFileSync(entry, JSON.stringify({ ...stored, savedAt: Date.now() - 3 * 3_600_000 }))
      const shortLived = run(undefined, undefined, undefined, { IPC_SOCKET_CACHE_TTL_HOURS: "2" })
      expect(shortLived.calls["npm/data-cap@0.4.0"]).toBe(2)
    })

    it("treats a nonsense lifetime as the default 24 hours", () => {
      run(pkg, config)
      const reused = run(undefined, undefined, undefined, { IPC_SOCKET_CACHE_TTL_HOURS: "-5" })
      expect(reused.calls["npm/data-cap@0.4.0"]).toBe(1)
    })

    it("never caches a failure", () => {
      const auth = JSON.stringify({ ok: false, message: "Auth Error", cause: "no token" })
      const failing = { socket: { "npm/data-cap@0.4.0": auth }, npm: '"0.4.0"' }
      expect(run(pkg, failing).out.ok).toBe(false)
      expect(run(undefined, undefined).calls["npm/data-cap@0.4.0"]).toBe(2)
    })

    it("is bypassed entirely when switched off", () => {
      run(pkg, config, undefined, { IPC_SOCKET_CACHE: "off" })
      const again = run(undefined, undefined, undefined, { IPC_SOCKET_CACHE: "off" })
      expect(again.calls["npm/data-cap@0.4.0"]).toBe(2)
      expect(again.out.data["cached"]).toBeUndefined()
    })

    it("reuses the latest published version's score for an unpublished version", () => {
      const unpublished = { name: "data-cap", version: "9.9.9" }
      const fallback = {
        socket: { "npm/data-cap@9.9.9": notFound, "npm/data-cap@0.4.0": fixture },
        npm: '"0.4.0"',
        npmFor: { "data-cap@9.9.9": JSON.stringify({ error: { code: "E404" } }) },
      }
      run(unpublished, fallback)
      const again = run(undefined, undefined)
      expect(again.calls["npm/data-cap@9.9.9"]).toBe(1)
      expect(again.calls["npm/data-cap@0.4.0"]).toBe(1)
      expect(again.out.data).toMatchObject({
        cached: true,
        requestedVersion: "9.9.9",
        scoredVersion: "0.4.0",
      })
    })

    it("falls back to scanning when the cache directory cannot be written", () => {
      const blocker = path.join(cwd, "blocker")
      writeFileSync(blocker, "a file, not a directory")
      const result = run(pkg, config, undefined, {
        IPC_SOCKET_CACHE_DIR: path.join(blocker, "nested"),
      })
      expect(result.out.ok).toBe(true)
      expect(result.out.data.alerts.length).toBeGreaterThan(0)
    })
  })
})
