// `internal-package-contract init` -- scaffold the repo-maintenance files and
// git wiring a package needs to adopt the standard. Non-destructive: existing
// files are left alone unless `--force` is passed.

import { sync as spawnSync } from "cross-spawn"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cwd = process.cwd()
const force = process.argv.includes("--force")
const done = []
const skipped = []

/** Copy `template/<from>` to `<cwd>/<to>` unless it exists (or --force). */
function scaffold(from, to) {
  const dest = path.join(cwd, to)
  if (existsSync(dest) && !force) {
    skipped.push(`${to} (exists)`)
    return
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(path.join(packageRoot, "template", from), dest)
  done.push(to)
}

scaffold("gitignore", ".gitignore")
scaffold("gitattributes", ".gitattributes")
scaffold("editorconfig", ".editorconfig")
scaffold("gitmessage", ".gitmessage")
scaffold("contract.yml", ".github/workflows/contract.yml")
scaffold("release.yml", ".github/workflows/release.yml")

// .nvmrc -- mirror this package's own supported Node.
const nvmrcDest = path.join(cwd, ".nvmrc")
if (!existsSync(nvmrcDest) || force) {
  let node = "24\n"
  try {
    node = readFileSync(path.join(packageRoot, ".nvmrc"), "utf8")
  } catch {
    /* default */
  }
  writeFileSync(nvmrcDest, node)
  done.push(".nvmrc")
} else {
  skipped.push(".nvmrc (exists)")
}

// package.json -- ensure the `contract` script.
const pkgPath = path.join(cwd, "package.json")
try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  pkg.scripts ??= {}
  if (pkg.scripts.contract !== "internal-package-contract") {
    pkg.scripts.contract = "internal-package-contract"
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    done.push('package.json scripts.contract = "internal-package-contract"')
  } else {
    skipped.push("package.json scripts.contract (already set)")
  }
} catch {
  skipped.push("package.json (could not read/update -- add the `contract` script manually)")
}

// git wiring -- hooks + commit template. Prefer the in-repo install path
// (git resolves core.hooksPath relative to the repo root); fall back to the
// package's absolute hooks dir when it is not installed under the consumer yet.
const inRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd }).status === 0
if (inRepo) {
  const installedHooks = path.join(cwd, "node_modules", "internal-package-contract", "hooks")
  const hooksPath = existsSync(installedHooks)
    ? "node_modules/internal-package-contract/hooks"
    : path.join(packageRoot, "hooks")
  spawnSync("git", ["config", "core.hooksPath", hooksPath], { cwd })
  spawnSync("git", ["config", "commit.template", ".gitmessage"], { cwd })
  done.push(`git core.hooksPath -> ${hooksPath}`, "git commit.template -> .gitmessage")
} else {
  skipped.push("git config (not a git repo -- run `git init` then re-run)")
}

process.stdout.write("\ninternal-package-contract init\n\n")
for (const d of done) process.stdout.write(`  + ${d}\n`)
for (const s of skipped) process.stdout.write(`  · ${s}\n`)
process.stdout.write(
  "\nNext: `npm install` (if internal-package-contract isn't a devDependency yet), then `npm run contract`.\n",
)
