// `internal-package-contract sync --release`: the whole `version` script of a package that follows the standard.
//
// Changesets runs `npm run version` to open the "chore: version packages" pull request. Every file that records
// the version must change in that one commit, or the release's own contract fails on it. Spelled out in each
// package's script, the steps drifted apart: one package lacked the lockfile step, another the baselines. One
// command keeps a single list.
//
// The steps run in order in the package's root, and the first that fails stops the run:
//   - `changeset version`;
//   - `npm install --package-lock-only --ignore-scripts`, so package-lock.json records the new version;
//   - `npm run build`, when package.json has a `build` script, because the baselines read `dist/`;
//   - `update-baseline`, so `ApiContract` and `SurfaceContract` compare against this version;
//   - `npm run examples:update-golden`, when package.json has it;
//   - the SBOMs, when the package keeps them: its `sbom` script, else `tool sbom`;
//   - `skill` with `docs/skill.json`, and `site` with `docs/site.json`, since both print the version.
// The standard's own commands run through this file's `bin/contract.mjs` with the running Node, so they come from
// the installed release and need nothing on PATH.
//
// It refuses to start outside a git repository or with uncommitted changes, so a failed run can be undone exactly.
// Pending changesets are the exception: the release workflow generates them in the step before this one, and
// `changeset version` consumes them. Any other change could be one the run overwrites, since the package's own
// scripts may write any file. The run records each pending changeset's status and content hash first. Its advice
// then names only the files whose state the run changed.

import { spawnSync } from "node:child_process"
import { hash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { runCommand } from "../upgrade/run.mjs"

/** @typedef {[label: string, command: string, args: string[]]} Step */

/**
 * @param {string} cwd - the package root.
 * @param {string} packageRoot - this package's root.
 * @returns {Step[]} the steps, in the order they run.
 */
export function releaseSteps(cwd, packageRoot) {
  const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
  const scripts = manifest.scripts ?? {}
  const has = (/** @type {string} */ name) => typeof scripts[name] === "string"
  const checks = manifest["internal-package-contract"]?.checks
  // The version bump changes the SBOMs' root component, so a package that keeps them must rewrite them too.
  const keepsSbom =
    existsSync(path.join(cwd, "docs", "sbom.cdx.json")) ||
    (Array.isArray(checks) && checks.includes("Sbom"))
  const bin = path.join(packageRoot, "bin", "contract.mjs")
  /** @type {Step[]} */
  const steps = [
    ["version the package from its changesets", "npx", ["--no-install", "changeset", "version"]],
    [
      "update package-lock.json to the new version",
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts"],
    ],
  ]
  if (has("build")) steps.push(["build the package", "npm", ["run", "build"]])
  steps.push(["refresh the API and surface baselines", process.execPath, [bin, "update-baseline"]])
  if (has("examples:update-golden")) {
    steps.push(["regenerate the example goldens", "npm", ["run", "examples:update-golden"]])
  }
  if (has("sbom")) steps.push(["write the SBOMs", "npm", ["run", "sbom"]])
  else if (keepsSbom) steps.push(["write the SBOMs", process.execPath, [bin, "tool", "sbom"]])
  if (existsSync(path.join(cwd, "docs", "skill.json"))) {
    steps.push(["regenerate the agent skill", process.execPath, [bin, "skill"]])
  }
  if (existsSync(path.join(cwd, "docs", "site.json"))) {
    steps.push(["regenerate the landing page", process.execPath, [bin, "site"]])
  }
  return steps
}

/**
 * @param {string} cwd - a directory.
 * @returns {string | undefined} where `cwd` sits in its git repository, such as `packages/a/` or `""` at the
 *   root; `undefined` outside a repository.
 */
function repositoryPrefix(cwd) {
  const prefix = spawnSync("git", ["rev-parse", "--show-prefix"], { cwd, encoding: "utf8" })
  return prefix.status === 0 ? prefix.stdout.trim() : undefined
}

/** @typedef {{ path: string, created: boolean, code: string }} Change */

/**
 * @param {string} cwd - a directory in a git repository.
 * @param {string} here - its {@link repositoryPrefix}.
 * @returns {Change[]} every uncommitted change in the repository: its path relative to `cwd`, whether the file is
 *   new to git, and its state, the status code plus a hash of what the file holds now.
 */
function uncommitted(cwd, here) {
  // Porcelain paths are relative to the repository's root, whatever the working directory. A rename record
  // carries a second path, so renames are listed as a deletion and an addition instead.
  const status = spawnSync("git", ["status", "--porcelain", "-z", "--no-renames"], {
    cwd,
    encoding: "utf8",
  })
  return status.stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const file = path.posix.relative(here, entry.slice(3))
      const code = entry.slice(0, 2)
      return { path: file, created: code === "??", code }
    })
}

/**
 * @param {string} cwd - the package root.
 * @param {Change} change - a pending changeset's change, so a file or nothing at all.
 * @returns {string} its state: the status code, plus a hash of the file's bytes while it is a regular file.
 */
function stateOf(cwd, { path: file, code }) {
  const at = path.join(cwd, file)
  // A link is never followed: reading one to a FIFO or /dev/zero would never finish.
  return lstatSync(at, { throwIfNoEntry: false })?.isFile()
    ? `${code} ${hash("sha256", readFileSync(at))}`
    : code
}

/**
 * @param {string} file - a path relative to the package root.
 * @returns {boolean} whether it is a pending changeset, or the bump record the release workflow writes beside
 *   them. `changeset version` reads only `.md` files directly in `.changeset/`, never its README.
 */
function isPendingChangeset(file) {
  const name = file.slice(".changeset/".length)
  return (
    file.startsWith(".changeset/") &&
    !name.includes("/") &&
    (name === ".release-bump.json" || (name.endsWith(".md") && name !== "README.md"))
  )
}

/**
 * @param {string} file - a path.
 * @returns {string} the path as one POSIX shell word.
 */
function shellWord(file) {
  return /^[\w./@+-]+$/.test(file) ? file : `'${file.replaceAll("'", "'\\''")}'`
}

/**
 * @param {string} cwd - the package root.
 * @param {Map<string, string>} was - each pending changeset's {@link stateOf} when the run started.
 * @param {Change[]} after - the uncommitted changes now.
 * @returns {{ changed: string[], created: string[], lost: string[] }} what the run did, by how to undo it:
 *   committed files it changed, files it created, and pending changesets it changed or deleted.
 */
function runChanges(cwd, was, after) {
  const now = new Set(after.map(({ path: file }) => file))
  /** @type {{ changed: string[], created: string[], lost: string[] }} */
  const changes = { changed: [], created: [], lost: [] }
  // git lists each kind in path order already.
  for (const change of after) {
    const old = was.get(change.path)
    if (old === undefined) changes[change.created ? "created" : "changed"].push(change.path)
    else if (old !== stateOf(cwd, change)) changes.lost.push(change.path)
  }
  // A pending changeset `changeset version` deleted leaves no trace in git at all.
  for (const file of was.keys()) if (!now.has(file)) changes.lost.push(file)
  changes.lost.sort()
  return changes
}

/**
 * @param {string} label - the step that failed.
 * @param {{ changed: string[], created: string[], lost: string[] }} touched - what the run did, from
 *   {@link runChanges}.
 * @returns {string} how to undo the run, naming only those files.
 */
function undoAdvice(label, { changed, created, lost }) {
  const stopped = `[sync] stopped: "${label}" failed. Nothing is committed`
  if (changed.length + created.length + lost.length === 0) {
    return `${stopped}, and the run changed no file.\n`
  }
  const lines = [`${stopped}.`]
  if (changed.length > 0) {
    lines.push(
      `The run changed these files: ${changed.join(", ")}.`,
      `Undo that with: git restore -- ${changed.map(shellWord).join(" ")}`,
    )
  }
  if (created.length > 0) {
    lines.push(
      `${changed.length > 0 ? "It also created" : "The run created"}: ${created.join(", ")}. Delete them to undo it.`,
    )
  }
  if (lost.length > 0) {
    lines.push(
      `${changed.length + created.length > 0 ? "It also changed" : "The run changed"} or deleted these uncommitted changesets: ${lost.join(", ")}.`,
      "`changeset version` deletes the changesets it consumes, and git restore cannot bring back uncommitted ones. Generate or write them again.",
    )
  }
  return `${lines.join("\n")}\n`
}

/**
 * @param {string} cwd - the package root.
 * @returns {boolean} whether `@changesets/cli`, which `changeset version` needs, resolves from the package.
 */
function hasChangesets(cwd) {
  try {
    createRequire(path.join(cwd, "package.json")).resolve("@changesets/cli/package.json")
  } catch {
    return false
  }
  return true
}

/**
 * Runs the release steps, stopping at the first that fails.
 * @param {string} cwd - the package root, which has a package.json.
 * @param {string} packageRoot - this package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {(command: string, args: string[], cwd: string) => number | null} [spawn] - how a command ends; a test seam.
 * @returns {number} the exit code: 0 when every step passed, else 1.
 */
export function runRelease(cwd, packageRoot, io, spawn = runCommand) {
  let steps
  try {
    steps = releaseSteps(cwd, packageRoot)
  } catch (error) {
    io.err(
      /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT"
        ? "[sync] there is no package.json here; run it from the package's root.\n"
        : `[sync] package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
  const here = repositoryPrefix(cwd)
  if (here === undefined) {
    io.err(
      "[sync] --release runs in a git repository, so a failed run can be undone. This directory is not in one.\n",
    )
    return 1
  }
  const before = uncommitted(cwd, here)
  const blocking = before.filter(({ path: file }) => !isPendingChangeset(file))
  if (blocking.length > 0) {
    io.err(
      `[sync] commit or stash these first, so a failed run can be undone without losing them:\n${blocking
        .map(({ path: file }) => `- ${file}\n`)
        .sort()
        .join("")}`,
    )
    return 1
  }
  const was = new Map(before.map((change) => [change.path, stateOf(cwd, change)]))
  if (!hasChangesets(cwd)) {
    io.err(
      "[sync] @changesets/cli is not installed here. Add it as a dev dependency (npm install --save-dev @changesets/cli), then run sync --release again.\n",
    )
    return 1
  }
  for (const [label, command, args] of steps) {
    io.out(`[sync] ${label}\n`)
    if (spawn(command, args, cwd) !== 0) {
      io.err(undoAdvice(label, runChanges(cwd, was, uncommitted(cwd, here))))
      return 1
    }
  }
  io.out("[sync] done. Review the release's changes before they are committed.\n")
  return 0
}
