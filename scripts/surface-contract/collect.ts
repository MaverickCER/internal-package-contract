/**
 * Reads a package's public surface besides its TypeScript API: the `--help` of each `bin`, the JSON
 * Schemas its `exports` serve, and the inputs and outputs of its root `action.yml`. See classify.ts
 * for how a difference is judged. Everything here is deterministic: keys are sorted and the CLI is
 * run with colour off, so two runs on the same commit give the same surface.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"
import { parse } from "yaml"

import type { ActionSurface, Surface } from "./classify.js"

/** Runs one CLI with `--help` and reports how it ended and what it printed. */
export type RunBin = (file: string, cwd: string) => { exitCode: number | null; stdout: string }

/**
 * @param file - The CLI's entry file.
 * @param cwd - The package root.
 * @returns The exit code and the help text (stdout, or stderr when stdout is empty).
 */
export const defaultRunBin: RunBin = (file, cwd) => {
  const result = spawnSync(process.execPath, [file, "--help"], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  })
  return { exitCode: result.status, stdout: result.stdout === "" ? result.stderr : result.stdout }
}

const normalizeHelp = (text: string): string =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()

/** Reads a JSON file, tolerating the comments and trailing commas a shared tsconfig or tool config carries. */
async function readJson(file: string): Promise<unknown> {
  const { config, error } = ts.parseConfigFileTextToJson(file, await readFile(file, "utf8"))
  if (error !== undefined) throw new Error(`${file} is not readable JSON.`)
  return config as unknown
}

/** The JSON files an `exports` entry serves: the file itself, or one per match of a `*` pattern. */
async function schemaFiles(root: string, key: string, target: string): Promise<[string, string][]> {
  if (!key.includes("*")) return [[key, target]]
  const slash = target.lastIndexOf("/")
  const dir = target.slice(0, slash + 1)
  const fileName = target.slice(slash + 1)
  const star = fileName.indexOf("*")
  if (star === -1) return []
  const [prefix, suffix] = [fileName.slice(0, star), fileName.slice(star + 1)]
  const entries = await readdir(path.join(root, dir)).catch(() => [] as string[])
  return entries
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => [
      key.replaceAll("*", name.slice(prefix.length, name.length - suffix.length)),
      `${dir}${name}`,
    ])
}

async function collectAction(root: string): Promise<ActionSurface | null> {
  const file = ["action.yml", "action.yaml"]
    .map((name) => path.join(root, name))
    .find((f) => existsSync(f))
  if (file === undefined) return null
  const doc = parse(await readFile(file, "utf8")) as {
    inputs?: Record<string, { required?: boolean; default?: unknown } | null>
    outputs?: Record<string, unknown>
  }
  const inputs: Record<string, { required: boolean; default: string | null }> = {}
  for (const [name, input] of Object.entries(doc.inputs ?? {})) {
    inputs[name] = {
      required: input?.required === true,
      default: input?.default === undefined ? null : String(input.default),
    }
  }
  return { inputs, outputs: Object.keys(doc.outputs ?? {}).sort() }
}

/**
 * @param root - The package root.
 * @param options - `runBin` replaces how a CLI is run (tests, or a sandbox).
 * @returns The package's current surface. Throws if a declared `bin` or schema file is missing, since
 *   that means the package has not been built.
 */
export async function collectSurface(
  root: string,
  options: { runBin?: RunBin } = {},
): Promise<Surface> {
  const runBin = options.runBin ?? defaultRunBin
  const pkg = (await readJson(path.join(root, "package.json"))) as {
    name: string
    bin?: string | Record<string, string>
    exports?: Record<string, unknown>
  }

  const bins =
    typeof pkg.bin === "string"
      ? { [pkg.name.slice(pkg.name.lastIndexOf("/") + 1)]: pkg.bin }
      : (pkg.bin ?? {})
  const cli: Record<string, { exitCode: number | null; help: string }> = {}
  for (const name of Object.keys(bins).sort()) {
    const file = path.join(root, bins[name]!)
    if (!existsSync(file)) {
      throw new Error(
        `bin "${name}" points at ${bins[name]!}, which does not exist; build the package before running the surface check.`,
      )
    }
    const { exitCode, stdout } = runBin(file, root)
    cli[name] = { exitCode, help: normalizeHelp(stdout) }
  }

  const schemas: Record<string, unknown> = {}
  const exported = Object.entries(pkg.exports ?? {})
  for (const [key, target] of exported.sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof target !== "string" || !target.endsWith(".json") || key === "./package.json")
      continue
    for (const [subpath, file] of await schemaFiles(root, key, target)) {
      schemas[subpath] = await readJson(path.join(root, file))
    }
  }

  return { cli, schemas, action: await collectAction(root) }
}
