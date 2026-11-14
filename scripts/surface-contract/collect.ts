/**
 * Reads a package's surface besides its TypeScript API: the `--help` of each `package.json` `bin` and of
 * every command that help lists, the JSON Schemas its `exports` serve, and the inputs and outputs of its
 * root `action.yml`. Each CLI is run with colour off and keys are sorted, so two runs on one commit read
 * the same surface. A CLI that is not built yet, or that prints its help to stderr, is read as it is;
 * classify.ts judges the difference. Each reusable workflow under `.github/workflows/` (one with
 * `on.workflow_call`) is read for its inputs, outputs and secrets.
 *
 * A listed command is a help line indented two spaces whose first word, optionally after the bin's own
 * name, is a lowercase word followed by two or more spaces (`  init   Scaffold ...`). Each one runs as
 * `<bin> <command> --help`, so every command must print its help and exit without side effects.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"
import { parse } from "yaml"

import type { ActionSurface, CliSurface, Surface } from "./classify.js"

/** Runs one CLI with the given arguments (`--help` alone by default) and reports how it ended and what it printed. */
export type RunBin = (
  file: string,
  cwd: string,
  args?: readonly string[],
) => { exitCode: number | null; stdout: string }

/**
 * @param file - The CLI's entry file.
 * @param cwd - The package root.
 * @param args - What to pass; a command's help is `[command, "--help"]`.
 * @returns The exit code and the help text (stdout, or stderr when stdout is empty).
 */
export const defaultRunBin: RunBin = (file, cwd, args = ["--help"]) => {
  const result = spawnSync(process.execPath, [file, ...args], {
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

/**
 * @param help - A CLI's normalized top-level help.
 * @param bin - The bin's own name, which a help line may repeat before the command.
 * @returns The command names the help lists, sorted and without repeats.
 * @internal Exported for direct unit coverage.
 */
export function listedCommands(help: string, bin: string): string[] {
  const escaped = bin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const line = new RegExp(`^  (?:${escaped} )?([a-z][a-z0-9-]*) {2,}\\S`)
  const names = help.split("\n").flatMap((text) => {
    const match = line.exec(text)
    return match === null ? [] : [match[1] as string]
  })
  return [...new Set(names)].sort()
}

/** Reads a JSON file, tolerating the comments and trailing commas a shared tsconfig or tool config carries. */
async function readJson(file: string): Promise<unknown> {
  const { config, error } = ts.parseConfigFileTextToJson(
    file.replaceAll("\\", "/"),
    await readFile(file, "utf8"),
  )
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

/**
 * @param root - The package root.
 * @returns The `on.workflow_call` interface of each reusable workflow, keyed by file name. A secret is an
 *   input named `secrets.<name>`. A workflow file that is not valid YAML is skipped: `GithubActions` judges it.
 */
async function collectWorkflows(root: string): Promise<Record<string, ActionSurface>> {
  const dir = path.join(root, ".github", "workflows")
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => /\.ya?ml$/.test(n))
    .sort()
  const workflows: Record<string, ActionSurface> = {}
  for (const name of names) {
    const doc = await readFile(path.join(dir, name), "utf8")
      .then((text) => parse(text) as { on?: unknown } | null)
      .catch(() => undefined)
    const on = doc?.on
    if (on === null || typeof on !== "object" || !("workflow_call" in on)) continue
    const call = ((on as Record<string, unknown>)["workflow_call"] ?? {}) as {
      inputs?: Record<string, { required?: boolean; default?: unknown } | null>
      outputs?: Record<string, unknown>
      secrets?: Record<string, { required?: boolean } | null>
    }
    const inputs: Record<string, { required: boolean; default: string | null }> = {}
    for (const [input, spec] of Object.entries(call.inputs ?? {})) {
      inputs[input] = {
        required: spec?.required === true,
        default: spec?.default === undefined ? null : String(spec.default),
      }
    }
    for (const [secret, spec] of Object.entries(call.secrets ?? {})) {
      inputs[`secrets.${secret}`] = { required: spec?.required === true, default: null }
    }
    workflows[name] = { inputs, outputs: Object.keys(call.outputs ?? {}).sort() }
  }
  return workflows
}

/**
 * The Markdown headings a package's generators write, read from their source: every line of a plain string
 * literal that starts with `#`. A heading built from data (a template with a substitution) is left out, since
 * its text changes with the input, not with the format.
 * @param root - The package root.
 * @param files - The renderer source files, from package.json `internal-package-contract.surfaceRenderers`.
 * @returns The headings, sorted and without repeats. Throws when a listed file does not exist.
 * @internal Exported for direct unit coverage.
 */
export async function collectDocumentHeadings(
  root: string,
  files: readonly string[],
): Promise<string[]> {
  const headings = new Set<string>()
  for (const file of files) {
    const absolute = path.join(root, file)
    if (!existsSync(absolute)) {
      throw new Error(
        `surfaceRenderers lists ${file}, which does not exist; fix package.json "internal-package-contract".surfaceRenderers.`,
      )
    }
    const text = await readFile(absolute, "utf8")
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest)
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        for (const line of node.text.split("\n")) {
          if (/^#{1,6} \S/.test(line)) headings.add(line.trim())
        }
      }
      node.forEachChild(visit)
    }
    visit(source)
  }
  return [...headings].sort()
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
  const cli: Record<string, CliSurface> = {}
  for (const name of Object.keys(bins).sort()) {
    const file = path.join(root, bins[name]!)
    if (!existsSync(file)) {
      throw new Error(
        `bin "${name}" points at ${bins[name]!}, which does not exist; build the package before running the surface check.`,
      )
    }
    const { exitCode, stdout } = runBin(file, root)
    const help = normalizeHelp(stdout)
    const commands: Record<string, { exitCode: number | null; help: string }> = {}
    for (const command of listedCommands(help, name)) {
      const sub = runBin(file, root, [command, "--help"])
      commands[command] = { exitCode: sub.exitCode, help: normalizeHelp(sub.stdout) }
    }
    cli[name] = { exitCode, help, commands }
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

  const renderers = (pkg as { "internal-package-contract"?: { surfaceRenderers?: unknown } })[
    "internal-package-contract"
  ]?.surfaceRenderers
  return {
    cli,
    schemas,
    action: await collectAction(root),
    workflows: await collectWorkflows(root),
    ...(Array.isArray(renderers)
      ? { documents: await collectDocumentHeadings(root, renderers.map(String)) }
      : {}),
  }
}
