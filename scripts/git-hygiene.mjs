// Evidence gatherer for the `GitHygiene` check (see checks/git-hygiene.ts). Prints one JSON object and
// always exits 0; the policy decides the verdict.
//
// What is read, from the working directory: whether it is a git repository, every tracked path, and the
// tracked text files holding a merge-conflict marker (through `git grep`, which skips binary files). Also
// the imports of tracked source that resolve only to a file git does not track
// (scripts/git-hygiene/imports.mjs), and the text of .gitignore. Last, whether .gitattributes, .editorconfig
// and .nvmrc exist, and which of `private`, `files`, `license`, `repository`, `engines.node`, `type` and
// `packageManager` package.json carries.

import { sync as spawnSync } from "cross-spawn"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { SOURCE_FILE, untrackedImports } from "./git-hygiene/imports.mjs"

const cwd = process.cwd()

function git(args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  return { ok: r.status === 0 && !r.error, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

function readIfExists(rel) {
  try {
    return readFileSync(path.join(cwd, rel), "utf8")
  } catch {
    return undefined
  }
}

const isRepo = git(["rev-parse", "--is-inside-work-tree"]).ok
const tracked = isRepo
  ? git(["ls-files"])
      .stdout.split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  : []

// Conflict markers in tracked files (text only: git grep skips binary).
const conflict = git(["grep", "-lE", "^(<{7}|={7}|>{7})( |$)", "--", "."])
const conflictFiles = conflict.ok
  ? conflict.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  : []

// Imports in tracked source that only resolve to a file git does not track (ignored, or never added).
const trackedSet = new Set(tracked)
const sources = Object.fromEntries(
  tracked
    .filter((file) => SOURCE_FILE.test(file) && !file.startsWith("node_modules/"))
    .map((file) => [file, readIfExists(file) ?? ""]),
)
const untrackedTargets = untrackedImports({
  files: sources,
  tracked: trackedSet,
  existsOnDisk: (file) => {
    try {
      return statSync(path.join(cwd, file)).isFile()
    } catch {
      return false
    }
  },
})

const pkg = (() => {
  try {
    return JSON.parse(readIfExists("package.json") ?? "{}")
  } catch {
    return {}
  }
})()

process.stdout.write(
  `${JSON.stringify({
    isRepo,
    gitignore: readIfExists(".gitignore"),
    gitattributesPresent: existsSync(path.join(cwd, ".gitattributes")),
    editorconfigPresent: existsSync(path.join(cwd, ".editorconfig")),
    nvmrcPresent: existsSync(path.join(cwd, ".nvmrc")),
    tracked,
    conflictFiles,
    untrackedTargets,
    pkg: {
      private: pkg.private === true,
      hasFiles: Array.isArray(pkg.files) && pkg.files.length > 0,
      hasLicense: typeof pkg.license === "string" && pkg.license.length > 0,
      hasRepository: Boolean(pkg.repository),
      hasEnginesNode: Boolean(pkg.engines && pkg.engines.node),
      hasType: pkg.type === "module" || pkg.type === "commonjs",
      hasPackageManager: typeof pkg.packageManager === "string",
    },
  })}\n`,
)
