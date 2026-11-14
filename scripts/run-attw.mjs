// Runs @arethetypeswrong/cli for the `TypeResolution` check (see checks/arethetypeswrong.ts) with its
// stdout redirected to reports/arethetypeswrong.json instead of a pipe. The policy reads that file; this
// script only produces the evidence and passes attw's exit code through.
//
// Why a file: attw's `--format json` output can be truncated when attw writes to a pipe, and the contract
// runner captures every check's stdout through a pipe, so the preset's own `run` could not parse the
// report. Writing to a regular file does not hit that limit.
//
// Why `npm pack --ignore-scripts` instead of attw's own `--pack .`: attw packs without `--ignore-scripts`,
// which runs the consumer's `prepare` lifecycle (often a build that first deletes `dist/`) while every
// other check that reads `dist/` is running.
//
// `--exclude=<name,...>` names the entry points attw skips; by default `schema`, whose subpaths are JSON
// assets that attw's legacy `node10` resolver flags although they are not code. The PATH shim at the top
// lets `attw` resolve when this package is installed as a symlink and not hoisted.

import { sync as spawnSync } from "cross-spawn"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// Put every node_modules/.bin between this script and the filesystem root on
// PATH, so `attw` resolves whether this package is symlinked (`file:` dep, not
// hoisted) or installed normally. `bin/contract.mjs` already does this for the
// contract run as a whole; repeated here so the script also works when invoked
// directly.
for (let dir = import.meta.dirname; ;) {
  const bin = path.join(dir, "node_modules", ".bin")
  if (existsSync(bin)) process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}

const JSON_TOKEN = new Set(["[", "]", "{", "}", "[]", "{}"])
const JSON_CLOSE = new Set(["]", "}", "[]", "{}"])

/** Parse `npm pack --json` stdout, tolerant of npm prefixing its own log lines ahead of the payload. */
function parseNpmPackFilename(stdout, stderr) {
  const attempt = (text) => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  let parsed = attempt(stdout.trim())
  if (parsed === undefined) {
    const lines = stdout.split(/\r?\n/)
    const start = lines.findIndex((line) => JSON_TOKEN.has(line.trim()))
    const end = start === -1 ? -1 : lines.findLastIndex((line) => JSON_CLOSE.has(line.trim()))
    if (start !== -1 && end >= start) parsed = attempt(lines.slice(start, end + 1).join("\n"))
  }

  // npm <= 11 prints an array of results; npm 12 prints an object keyed by package name.
  const entries = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed)
      : []
  if (typeof entries[0]?.filename !== "string") {
    throw new Error(
      `npm pack --json produced an unexpected shape.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }

  return entries[0].filename
}

// Every attw entrypoint name (without the leading "./") to skip. `schema` and
// any `schema/*` subpath are bare `*.schema.json` assets, not code/types
// entrypoints. The legacy `node10` resolver in attw flags a raw-JSON subpath
// export; that is a limit of the resolver, not a packaging defect.
const excludeArg = process.argv.slice(2).find((a) => a.startsWith("--exclude="))
const excludeEntrypoints = (excludeArg ? excludeArg.slice("--exclude=".length) : "schema")
  .split(",")
  .filter(Boolean)

mkdirSync("reports", { recursive: true })
const packDir = mkdtempSync(path.join(tmpdir(), "ipc-attw-pack-"))

try {
  const pack = spawnSync(
    "npm",
    ["pack", "--pack-destination", packDir, "--json", "--loglevel=silent", "--ignore-scripts"],
    { encoding: "utf8" },
  )
  if (pack.error) throw pack.error
  if (pack.status !== 0) {
    throw new Error(`npm pack failed (exit ${String(pack.status)}):\n${pack.stderr || pack.stdout}`)
  }

  const tarball = path.join(packDir, parseNpmPackFilename(pack.stdout, pack.stderr))

  const attwArgs = [tarball, "--format", "json"]
  for (const entrypoint of excludeEntrypoints) attwArgs.push("--exclude-entrypoints", entrypoint)

  const fd = openSync("reports/arethetypeswrong.json", "w")
  let result
  try {
    result = spawnSync("attw", attwArgs, { stdio: ["ignore", fd, "inherit"] })
  } finally {
    closeSync(fd)
  }

  if (result.error) throw result.error

  // The exit code is passed through as is. A non-zero one means attw found
  // problems, and the policy reads them from the JSON report.
  process.exitCode = typeof result.status === "number" ? result.status : 1
} finally {
  rmSync(packDir, { recursive: true, force: true })
}
