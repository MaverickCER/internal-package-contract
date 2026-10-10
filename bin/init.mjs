// `internal-package-contract init` -- scaffold the repo-maintenance files and
// git wiring a package needs to adopt the standard. Non-destructive: existing
// files are left alone unless `--force` is passed.

import { sync as spawnSync } from "cross-spawn"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  REQUIRED_STATUS_CHECK_CONTEXT,
  mergeRequiredRules,
  resolveOwnerRepo,
  rulesetCoversBranch,
} from "../scripts/github-repo.mjs"
import {
  buildPinVars,
  buildVars,
  listTemplateFiles,
  parseInitArgs,
  render,
  renderJson,
  shaFromLockfile,
  validatePackageName,
} from "../scripts/init-lib.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cwd = process.cwd()
// Reached two ways: `bin/contract.mjs init ...` (the documented command, so argv[2] is the
// subcommand name itself) and `bin/init.mjs ...` directly. Only the flags go to the parser.
const args = parseInitArgs(process.argv.slice(process.argv[2] === "init" ? 3 : 2))
const force = args.force
const done = []
const skipped = []

const USAGE = `Usage: internal-package-contract init [--name <package-name> [--owner <github-owner>] [--description <text>]] [--force]

  Without --name: scaffolds repo-hygiene files and git wiring only.
  With --name:    ALSO scaffolds a complete, working package (package.json, src/, test/, tsup/tsconfig/
                  eslint/prettier/knip/stryker/typedoc/vitest configs, governance docs, GitHub
                  templates and workflows), replacing {{name}}/{{repo}}/{{owner}}/{{description}}/{{year}}.
                  --owner defaults to the origin remote's owner, else MaverickCER.
  --force:        overwrite files that already exist.
`

/**
 * The commit of this package to pin scaffolded workflows at: what the consumer's lockfile resolved,
 * else the checkout this CLI is running from. `undefined` when neither is known.
 */
function resolveIpcSha() {
  let lockText
  try {
    lockText = readFileSync(path.join(cwd, "package-lock.json"), "utf8")
  } catch {
    lockText = undefined
  }
  const fromLock = shaFromLockfile(lockText)
  if (fromLock !== undefined) return fromLock
  const head = spawnSync("git", ["-C", packageRoot, "rev-parse", "HEAD"], { encoding: "utf8" })
  const sha = head.status === 0 ? head.stdout.trim() : ""
  return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined
}

const ipcVersion = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).version
const pins = buildPinVars({ version: ipcVersion, sha: resolveIpcSha() })

const nameProblem = args.name === undefined ? undefined : validatePackageName(args.name)
if (args.errors.length > 0 || nameProblem !== undefined) {
  for (const problem of [...args.errors, ...(nameProblem === undefined ? [] : [nameProblem])]) {
    process.stderr.write(`${problem}\n`)
  }
  process.stderr.write(`\n${USAGE}`)
  process.exit(1)
}

/** Writes `template/package/<rel>` to `<cwd>/<rel>` with placeholders rendered, unless it exists (or --force). */
function scaffoldPackageFile(rel, vars) {
  const dest = path.join(cwd, rel)
  if (existsSync(dest) && !force) {
    skipped.push(`${rel} (exists)`)
    return
  }
  const source = readFileSync(path.join(packageRoot, "template", "package", rel), "utf8")
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(
    dest,
    rel.endsWith(".json") && rel === "package.json"
      ? renderJson(source, vars)
      : render(source, vars),
  )
  done.push(rel)
}

if (args.name !== undefined) {
  const owner = args.owner ?? resolveOwnerRepo(cwd)?.owner ?? "MaverickCER"
  const vars = buildVars({ name: args.name, owner, description: args.description, ...pins })
  for (const rel of listTemplateFiles(path.join(packageRoot, "template", "package"))) {
    // A workflow that calls one of this repository's reusable workflows is pinned by commit SHA; with
    // no SHA to pin it to, writing it would only produce a workflow that cannot run.
    if (pins.ipcSha === "" && rel.endsWith("sync-internal-package-contract.yml")) {
      skipped.push(`${rel} (no commit of internal-package-contract to pin it to -- see below)`)
      continue
    }
    scaffoldPackageFile(rel, vars)
  }
}

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

/** Like {@link scaffold}, with the pin placeholders (`{{ipcRef}}`, `{{ipcSha}}`) rendered. */
function scaffoldRendered(from, to) {
  const dest = path.join(cwd, to)
  if (existsSync(dest) && !force) {
    skipped.push(`${to} (exists)`)
    return
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  const text = readFileSync(path.join(packageRoot, "template", from), "utf8")
  writeFileSync(dest, render(text, { ipcRef: pins.ipcRef, ipcSha: pins.ipcSha }))
  done.push(to)
}

scaffold("gitignore", ".gitignore")
scaffold("gitattributes", ".gitattributes")
scaffold("editorconfig", ".editorconfig")
scaffold("gitmessage", ".gitmessage")
scaffold("contract.yml", ".github/workflows/contract.yml")
if (pins.ipcSha === "") {
  skipped.push(
    ".github/workflows/release.yml (it is pinned to a commit of internal-package-contract, and none could be resolved: run `npm install` so the lockfile pins one, then `init` again)",
  )
} else {
  scaffoldRendered("release.yml", ".github/workflows/release.yml")
}
scaffold("dependabot.yml", ".github/dependabot.yml")
scaffold("codeowners", "CODEOWNERS")
scaffold("security.md", "SECURITY.md")
scaffold("contributing.md", "CONTRIBUTING.md")
// The benchmarking guides ship with every package, with or without --name: one explains how to write
// and document benchmarks, the other how to read them.
scaffold("benchmarks/README.md", "benchmarks/README.md")
scaffold("benchmarks/WRITING-BENCHMARKS.md", "benchmarks/WRITING-BENCHMARKS.md")
scaffold("benchmarks/READING-BENCHMARKS.md", "benchmarks/READING-BENCHMARKS.md")

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

// GitHub branch protection -- idempotently ensure the default branch blocks
// deletion, blocks force-pushes, and cannot be merged into without a PR
// (`required_approving_review_count: 0` -- still forces every change through
// a PR, without requiring a second reviewer on a solo-maintained repo), requires
// the `contract` status check (strict) before a merge, and requires review
// threads to be resolved (so CodeRabbit's and humans' findings block until answered).
// Best-effort, like everything else here: skipped with a warning, never a
// hard failure, when `gh` isn't installed/authenticated or the remote isn't
// a recognizable GitHub repo. `checks/branch-protection.ts` verifies this
// same state on every `npm run contract`, so it can't silently regress once
// set up. See that check's companion `scripts/check-branch-protection.mjs`
// for the read-only equivalent of the resolution logic below.
function ghApi(args) {
  return spawnSync("gh", ["api", ...args], { cwd, encoding: "utf8" })
}

function upsertBranchProtection() {
  if (spawnSync("gh", ["--version"], { cwd }).status !== 0) {
    skipped.push("GitHub branch protection (gh CLI not found)")
    return
  }
  if (spawnSync("gh", ["auth", "status"], { cwd }).status !== 0) {
    skipped.push("GitHub branch protection (gh CLI not authenticated -- run `gh auth login`)")
    return
  }
  const ownerRepo = resolveOwnerRepo(cwd)
  if (!ownerRepo) {
    skipped.push("GitHub branch protection (origin remote is not a recognizable GitHub URL)")
    return
  }
  const { owner, repo } = ownerRepo

  const branchResult = ghApi([`repos/${owner}/${repo}`, "--jq", ".default_branch"])
  if (branchResult.status !== 0) {
    skipped.push(
      `GitHub branch protection (could not read repos/${owner}/${repo}: ${branchResult.stderr.trim()})`,
    )
    return
  }
  const defaultBranch = branchResult.stdout.trim()

  const listResult = ghApi([`repos/${owner}/${repo}/rulesets`])
  if (listResult.status !== 0) {
    skipped.push(`GitHub branch protection (could not list rulesets: ${listResult.stderr.trim()})`)
    return
  }
  // Any enforcement state, not just "active" -- a disabled ruleset already
  // targeting the branch (left over from an earlier, half-finished setup)
  // should be reactivated in place, not shadowed by a second, duplicate
  // ruleset that would leave the disabled one sitting there unenforced.
  const summaries = JSON.parse(listResult.stdout || "[]")
  const branchRulesetIds = summaries.filter((r) => r.target === "branch").map((r) => r.id)

  let existing
  for (const id of branchRulesetIds) {
    const detailResult = ghApi([`repos/${owner}/${repo}/rulesets/${String(id)}`])
    if (detailResult.status !== 0) continue
    const ruleset = JSON.parse(detailResult.stdout || "{}")
    if (rulesetCoversBranch(ruleset, defaultBranch)) {
      existing = ruleset
      break
    }
  }

  const { rules: mergedRules, changes } = mergeRequiredRules(existing?.rules ?? [])
  const alreadyActive = existing?.enforcement === "active"
  if (existing && changes.length === 0 && alreadyActive) {
    skipped.push(
      `GitHub branch protection (${owner}/${repo}#${defaultBranch} already requires deletion, force-push and PR protection, the ${REQUIRED_STATUS_CHECK_CONTEXT} check, and resolved review threads)`,
    )
    return
  }

  if (existing) {
    // GitHub's ruleset-update endpoint is PUT, not PATCH -- it also replaces the
    // whole `rules` array wholesale, which is exactly why `mergedRules` above
    // starts from the existing rules rather than sending only what's new.
    // `enforcement: "active"` reactivates a disabled leftover ruleset in
    // place, rather than shadowing it with a second, duplicate one.
    const putResult = spawnSync(
      "gh",
      [
        "api",
        "-X",
        "PUT",
        `repos/${owner}/${repo}/rulesets/${String(existing.id)}`,
        "--input",
        "-",
      ],
      {
        cwd,
        encoding: "utf8",
        input: JSON.stringify({ enforcement: "active", rules: mergedRules }),
      },
    )
    if (putResult.status !== 0) {
      skipped.push(
        `GitHub branch protection (updating the ruleset failed: ${putResult.stderr.trim()})`,
      )
      return
    }
    const summary = [
      ...(changes.length > 0 ? [changes.join(", ")] : []),
      ...(alreadyActive ? [] : ["reactivated it"]),
    ].join(", ")
    done.push(
      `GitHub branch protection: ${summary} on ${owner}/${repo}#${defaultBranch}'s existing ruleset`,
    )
    return
  }

  const createResult = spawnSync(
    "gh",
    ["api", "-X", "POST", `repos/${owner}/${repo}/rulesets`, "--input", "-"],
    {
      cwd,
      encoding: "utf8",
      input: JSON.stringify({
        name: "protect-default-branch",
        target: "branch",
        enforcement: "active",
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
        rules: mergedRules,
      }),
    },
  )
  if (createResult.status !== 0) {
    skipped.push(
      `GitHub branch protection (creating a ruleset failed: ${createResult.stderr.trim()})`,
    )
    return
  }
  done.push(
    `GitHub branch protection: created a ruleset on ${owner}/${repo}#${defaultBranch} (deletion, force-push, PR-required, the ${REQUIRED_STATUS_CHECK_CONTEXT} check, resolved review threads)`,
  )
}

upsertBranchProtection()

process.stdout.write("\ninternal-package-contract init\n\n")
for (const d of done) process.stdout.write(`  + ${d}\n`)
for (const s of skipped) process.stdout.write(`  · ${s}\n`)
process.stdout.write(
  "\nNext: `npm install` (if internal-package-contract isn't a devDependency yet), then `npm run contract`.\n",
)
