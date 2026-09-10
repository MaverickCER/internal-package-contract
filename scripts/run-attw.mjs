// Runs @arethetypeswrong/cli with its stdout redirected to a real file rather
// than a pipe.
//
// attw's own `--format json` output balloons past ~64KB once a package has more
// than a couple of entrypoints, and attw has a real, reproducible bug (confirmed
// independently, via plain shell piping) where it truncates its own stdout once
// that happens, because it is writing to a pipe rather than a TTY or a regular
// file. repo-contract captures every check's stdout through a pipe, so the
// `arethetypeswrong` preset's own `run` hits the truncation and the JSON fails
// to parse. A regular-file write does not hit the same OS pipe-buffer limit, so
// redirecting here sidesteps the bug entirely -- the same workaround
// repo-contract itself uses for its own contract (scripts/run-attw-to-file.mjs).
//
// Packs the tarball with `npm pack --ignore-scripts` and hands attw the .tgz,
// rather than attw's own `--pack .` mode: `--pack .` runs a plain `npm pack`
// internally with no `--ignore-scripts`, which triggers the consumer's `prepare`
// lifecycle (typically `npm run build`, often starting by deleting `dist/`) mid
// run -- racing every other package check that reads `dist/` concurrently
// (`Packaging`/publint chief among them).
//
// The consumer's `contract.ts` policy reads reports/arethetypeswrong.json and
// interprets it. This script only produces the evidence.

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
    const end = start === -1 ? -1 : lines.map((line) => line.trim()).lastIndexOf("]")
    if (start !== -1 && end >= start) parsed = attempt(lines.slice(start, end + 1).join("\n"))
  }

  if (!Array.isArray(parsed) || typeof parsed[0]?.filename !== "string") {
    throw new Error(
      `npm pack --json produced an unexpected shape.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }

  return parsed[0].filename
}

// Every attw entrypoint name (without the leading "./") to skip. `schema` and
// any `schema/*` subpath are bare `*.schema.json` assets, not code/types
// entrypoints -- attw's legacy `node10` resolver flags a raw-JSON subpath
// export, which is a limitation of that resolver, not a packaging defect.
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

  // attw exits non-zero when it finds problems -- substantive evidence the
  // policy interprets from the JSON report, passed through verbatim.
  process.exitCode = typeof result.status === "number" ? result.status : 1
} finally {
  rmSync(packDir, { recursive: true, force: true })
}
