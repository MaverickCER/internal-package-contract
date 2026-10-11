// `internal-package-contract add export <name>`: runs the recipe against the current directory.
//
//   internal-package-contract add export <name>            write the files
//   internal-package-contract add export <name> --dry-run  print what would be written, change nothing
//
// A recipe is safe to run and safe to abandon. It refuses to start when a file it would change has
// uncommitted edits (git is the recovery journal: `git restore` undoes a run), prints every target before
// writing, computes all new text before writing any, and puts the originals back if a write fails.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { planAddExport } from "./add-export.mjs"

const USAGE = "Usage: internal-package-contract add export <name> [--dry-run]\n"

/** Files the recipe may read or change, all fixed repo-relative paths. */
const INPUTS = [
  "package.json",
  "tsup.config.ts",
  "scripts/emit-dts-shims.mjs",
  "typedoc.json",
  "typedoc.markdown.json",
  "knip.json",
]

/**
 * @param {string} cwd
 * @param {string[]} paths
 * @returns {string[]} the paths among `paths` that have uncommitted changes (empty outside a git repository).
 */
function uncommitted(cwd, paths) {
  const result = spawnSync("git", ["status", "--porcelain", "--", ...paths], {
    cwd,
    encoding: "utf8",
  })
  // Outside a repository, or with no git, there is no output and so nothing is reported.
  // Stryker disable next-line StringLiteral: equivalent -- the fallback only applies when git could not be started.
  return (result.stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
}

/**
 * @param {readonly string[]} argv - what follows `add`.
 * @param {string} cwd - the package root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {{ format?: (paths: string[]) => void, spawn?: typeof spawnSync }} [hooks] - test seams for the formatting step.
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io, hooks = {}) {
  const [recipe, name, ...flags] = argv
  const dryRun = flags.includes("--dry-run")
  if (recipe !== "export" || name === undefined || flags.some((flag) => flag !== "--dry-run")) {
    io.err(
      `[add] ${recipe === "export" ? "expected: add export <name> [--dry-run]" : `unknown recipe: ${recipe ?? "(none given)"}. Available: export.`}\n${USAGE}`,
    )
    return 2
  }

  const files = Object.fromEntries(
    [
      ...INPUTS,
      `src/${name}/index.ts`,
      `test/${name}.test.ts`,
      `.changeset/add-${name}-export.md`,
    ].map((file) => {
      const full = path.join(cwd, file)
      return [file, existsSync(full) ? readFileSync(full).toString() : undefined]
    }),
  )
  const plan = planAddExport({ name, files })
  if (plan.problems.length > 0) {
    io.err(
      `[add] nothing was written:\n${plan.problems.map((problem) => `- ${problem}`).join("\n")}\n`,
    )
    return 1
  }

  io.out(`${dryRun ? "Would write" : "Writing"}:\n`)
  for (const { path: file, created } of plan.writes) {
    io.out(`  ${created ? "create" : "update"}  ${file}\n`)
  }
  if (dryRun) return 0

  const dirty = uncommitted(
    cwd,
    plan.writes.map((write) => write.path),
  )
  if (dirty.length > 0) {
    io.err(
      `[add] nothing was written: these files have uncommitted changes, which a failed run could not tell apart from its own. Commit or stash them first:\n${dirty.map((file) => `- ${file}`).join("\n")}\n`,
    )
    return 1
  }

  const done = []
  try {
    for (const write of plan.writes) {
      const full = path.join(cwd, write.path)
      const original = write.created ? undefined : files[write.path]
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, write.text)
      done.push({ full, original })
    }
  } catch (error) {
    for (const { full, original } of done) {
      if (original === undefined) rmSync(full)
      else writeFileSync(full, original)
    }
    io.err(
      `[add] a write failed, and every file was put back: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }

  const format = hooks.format ?? defaultFormat(cwd, hooks.spawn ?? spawnSync)
  format(plan.writes.map((write) => write.path))
  io.out(
    `\nNext: write the export in src/${name}/index.ts, set the bump in .changeset/add-${name}-export.md, then run \`npm run docs:api:report\` and \`internal-package-contract update-baseline\`.\n`,
  )
  return 0
}

/** Formats what was written with the package's own Prettier, when it has one; a missing one is not an error. */
function defaultFormat(cwd, spawn) {
  return (paths) => {
    spawn("npx", ["--no-install", "prettier", "--write", ...paths], { cwd, stdio: "ignore" })
  }
}
