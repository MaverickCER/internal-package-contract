// `internal-package-contract init`: brings an existing package under this standard in one command.
//
//   internal-package-contract init [--tag vX.Y.Z] [--owner <github owner>] [--dry-run]
//
// It adds the pin and the `contract` script, installs, runs `init` for the files every package carries
// (hygiene files, the contract and release workflows, hooks, branch protection), adds what `init` leaves to a
// new package (the Scorecard and pin-sync workflows, the Changesets config), enrols the shared documents the
// package does not already have, drafts `docs/surface.json` from its exports, generates the API map, and ends
// with `doctor`, which lists what is left, including the steps only a person can take.
//
// It is built to be reviewed, not trusted: it refuses to start over uncommitted changes (git is the way back),
// never overwrites a file the package already has, and leaves every result as uncommitted changes. A document
// the package already has that differs from the standard's is left alone and named, so adopting never rewrites
// what a person wrote.

import { sync as spawnSync } from "cross-spawn"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { repositoryOwner } from "../repository-owner.mjs"
import { listTemplateFiles, render } from "../init-lib.mjs"
import { newAdoption, writeAdoption } from "../adoption/mode.mjs"
import { runCommand } from "../upgrade/run.mjs"
import { COPIES, docHeader, docVars } from "../managed-files/inspect.mjs"
import { draftSurface, findApiTable, seedFromTable } from "./surface.mjs"

const USAGE =
  "Usage: internal-package-contract init [--tag vX.Y.Z | --spec <dependency spec>] [--owner <github owner>] [--github] [--docs] [--strict] [--dry-run]\n"
const DEPENDENCY = "internal-package-contract"
const SOURCE = "MaverickCER/internal-package-contract"
const TAG = /^v\d+\.\d+\.\d+$/
const REGION =
  "\n## Public API map\n\n<!-- ipc:begin entry-points -->\n<!-- ipc:end entry-points -->\n"

/**
 * @param {readonly string[]} argv
 * @returns {{ tag?: string, spec?: string, owner?: string, dryRun: boolean, github: boolean, docs: boolean, strict: boolean, errors: string[] }}
 */
function parseArgs(argv) {
  /** @type {{ tag?: string, spec?: string, owner?: string, dryRun: boolean, github: boolean, docs: boolean, strict: boolean, errors: string[] }} */
  const args = { dryRun: false, github: false, docs: false, strict: false, errors: [] }
  const items = argv[Symbol.iterator]()
  for (const arg of items) {
    if (arg === "--dry-run") args.dryRun = true
    else if (arg === "--github") args.github = true
    else if (arg === "--docs") args.docs = true
    else if (arg === "--strict") args.strict = true
    else if (arg === "--tag" || arg === "--owner" || arg === "--spec") {
      const value = items.next().value
      if (value === undefined || value.startsWith("--")) args.errors.push(`${arg} needs a value.`)
      else args[arg.slice(2)] = value
    } else args.errors.push(`unknown argument: ${arg}`)
  }
  if (args.tag !== undefined && !TAG.test(args.tag))
    args.errors.push(`${args.tag} is not a release tag such as v0.12.0.`)
  if (args.tag !== undefined && args.spec !== undefined) {
    args.errors.push("--tag and --spec cannot be combined.")
  }
  return args
}

/** @param {string} text @returns {string | number} the indentation a JSON file already uses. */
function indentOf(text) {
  const match = /^\{\n([ \t]+)"/.exec(text)
  return match === null ? 2 : match[1].includes("\t") ? "\t" : match[1].length
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} where - the folder to run in.
 * @returns {{ status: number, stdout: string }} what the command printed, and 1 when it did not run to the end.
 */
export function captureCommand(command, args, where) {
  const result = spawnSync(command, args, { cwd: where, encoding: "utf8" })
  return { status: result.status ?? 1, stdout: result.stdout ?? "" }
}

/**
 * @param {(command: string, args: string[], cwd: string) => { status: number, stdout: string }} capture
 * @param {string} cwd
 * @returns {string | undefined} the newest release tag of the standard, as git lists them, or `undefined`.
 */
export function latestTag(capture, cwd) {
  return capture(
    "git",
    [
      "ls-remote",
      "--tags",
      "--refs",
      "--sort=-v:refname",
      `https://github.com/${SOURCE}.git`,
      "v[0-9]*",
    ],
    cwd,
  )
    .stdout.split("\n")[0]
    .replace(/.*refs\/tags\//, "")
    .trim()
}

/**
 * @param {readonly string[]} argv
 * @param {string} cwd - the package root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {{
 *   packageRoot: string,
 *   spawn?: (command: string, args: string[], cwd: string) => number,
 *   capture?: (command: string, args: string[], cwd: string) => { status: number, stdout: string },
 * }} hooks - `packageRoot` is where this package's templates are; the others are test seams.
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io, hooks) {
  const spawn = hooks.spawn ?? runCommand
  const capture = hooks.capture ?? captureCommand
  const args = parseArgs(argv)
  if (args.errors.length > 0) {
    io.err(`[init] ${args.errors.join(" ")}\n${USAGE}`)
    return 2
  }
  const manifestPath = path.join(cwd, "package.json")
  if (!existsSync(manifestPath)) {
    io.err(
      "[init] there is no package.json here. To start a new package use `init --name <package>` in an empty directory.\n",
    )
    return 1
  }
  const manifestText = readFileSync(manifestPath).toString()
  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    io.err("[init] package.json is not valid JSON.\n")
    return 1
  }
  if (typeof manifest.name !== "string") {
    io.err("[init] package.json has no name.\n")
    return 1
  }
  // A package that already depends on the standard is not refused: running `init` again finishes the setup,
  // writing only what is still missing, and never moves the pin (`upgrade` does that).
  const existingSpec = manifest.devDependencies?.[DEPENDENCY] ?? manifest.dependencies?.[DEPENDENCY]
  const alreadyAdopted = existingSpec !== undefined

  const remote = capture("git", ["remote", "get-url", "origin"], cwd)
  const fromRemote = repositoryOwner(remote.stdout)
  const fromManifest = repositoryOwner(manifest.repository)
  const owner = args.owner ?? fromManifest ?? fromRemote
  if (owner === undefined) {
    io.err(
      "[init] cannot tell who owns the repository: package.json has no repository and there is no GitHub origin remote. Pass --owner <github owner>.\n",
    )
    return 1
  }
  // `--spec` names the dependency outright (a fork, a mirror, or a local checkout while the standard itself is
  // being developed); the release lookup and the pin it gives are then not needed.
  const needsRelease = !alreadyAdopted && args.spec === undefined
  const tag = needsRelease ? (args.tag ?? latestTag(capture, cwd)) : undefined
  if (needsRelease && !TAG.test(String(tag))) {
    io.err(`[init] could not find a release of ${SOURCE}. Pass --tag vX.Y.Z.\n`)
    return 1
  }

  const dirty = capture("git", ["status", "--porcelain"], cwd).stdout.split("\n").filter(Boolean)
  if (dirty.length > 0) {
    io.err(
      `[init] commit or stash these first, so the adoption is a diff you can review and undo:\n${dirty.map((line) => `- ${line.slice(3)}`).join("\n")}\n`,
    )
    return 1
  }

  const plan = [
    alreadyAdopted
      ? `keep ${DEPENDENCY} where it is (${String(existingSpec)}) and add whatever is missing`
      : `add ${DEPENDENCY} (${args.spec ?? tag}) and the "contract" script to package.json${manifest.repository === undefined ? ", and its repository" : ""}`,
    "install, then scaffold the hygiene files, workflows, hooks and (with --github) branch protection",
    "write the Scorecard workflow, the pin-sync workflow and the Changesets config the package lacks (`init` and `sync`)",
    "add the configs, documents and templates the package lacks, and name any shared document it has that differs",
    "start adoption mode: failing checks report their errors but only promoted ones fail the run (--strict skips this)",
    "draft docs/surface.json from the exports, generate the API map and document the environment (ci/env.schema.ts)",
    "report what is left (`doctor`)",
  ]
  io.out(
    `[init] ${manifest.name}, owned by ${owner}${alreadyAdopted ? "" : `, to ${DEPENDENCY} ${args.spec ?? tag}`}:\n${plan.map((step) => `  - ${step}`).join("\n")}\n`,
  )
  if (args.dryRun) {
    io.out("[init] dry run: nothing was changed.\n")
    return 0
  }

  const name = manifest.name
  const repo = name.slice(name.indexOf("/") + 1)
  manifest.repository ??= { type: "git", url: `git+https://github.com/${owner}/${repo}.git` }
  manifest.scripts = { ...manifest.scripts, contract: DEPENDENCY }
  if (!alreadyAdopted) {
    manifest.devDependencies = {
      ...manifest.devDependencies,
      [DEPENDENCY]: args.spec ?? `github:${SOURCE}#${tag}`,
    }
  }
  // The rest of what the standard's tooling needs, added only where the package has nothing of its own: the
  // scripts the checks run (build, test, lint, docs) and the tools they use.
  const templateManifest = JSON.parse(
    readFileSync(path.join(hooks.packageRoot, "template", "package", "package.json")).toString(),
  )
  const additions = { scripts: [], devDependencies: [], overrides: [] }
  for (const field of ["scripts", "devDependencies", "overrides"]) {
    manifest[field] ??= {}
    for (const [key, value] of Object.entries(templateManifest[field] ?? {})) {
      if (key === DEPENDENCY || key in manifest[field]) continue
      manifest[field][key] = value
      additions[field].push(key)
    }
  }
  const writeManifest = () =>
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, indentOf(manifestText))}\n`)
  writeManifest()

  /** @param {string} label @param {string} command @param {string[]} commandArgs @param {boolean} [soft] - a failure is reported but does not stop the run. */
  const step = (label, command, commandArgs, soft = false) => {
    io.out(`[init] ${label}\n`)
    const succeeded = spawn(command, commandArgs, cwd) === 0
    if (!succeeded && soft) {
      io.out(`[init] "${label}" did not finish; \`doctor\` at the end says what is left.\n`)
    }
    if (!succeeded && !soft) {
      io.err(
        `[init] stopped: "${label}" failed. Nothing is committed; \`git restore .\` undoes the run (and delete untracked files with \`git clean\`).\n`,
      )
    }
    return succeeded || soft
  }
  const installed = `node_modules/${DEPENDENCY}`
  const bin = (file) => `${installed}/bin/${file}`
  if (!step("install", "npm", ["install", "--ignore-scripts"])) return 1
  // Repository settings are changed only when asked for: `--github` lets `init` apply branch protection.
  const initArgs = args.github ? [] : ["--no-github"]
  if (!step("scaffold the files every package carries", "node", [bin("scaffold.mjs"), ...initArgs]))
    return 1
  // A file that cannot be written yet (the pin-sync workflow needs a pinned commit) does not stop the adoption.
  step(
    "write the managed files the package lacks",
    "node",
    [bin("contract.mjs"), "sync", "--apply"],
    true,
  )

  // What `init` leaves to a new package, rendered for this one. The workflows, which carry the pin, are written by `sync`.
  const vars = {
    name,
    repo,
    owner,
    description: manifest.description ?? "",
    year: String(new Date().getFullYear()),
  }
  const written = []
  const templateRoot = path.join(hooks.packageRoot, "template", "package")
  /** @param {string} relative - a file of the template, written only when the package has none. */
  const writeIfAbsent = (relative) => {
    const destination = path.join(cwd, relative)
    if (existsSync(destination)) return
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(
      destination,
      render(readFileSync(path.join(templateRoot, relative)).toString(), vars),
    )
    written.push(relative)
  }
  const enrolled = new Set()
  const differing = []
  for (const copy of COPIES.filter((item) => item.kind === "doc")) {
    const wanted = `${docHeader(copy.from)}${render(readFileSync(path.join(hooks.packageRoot, copy.from)).toString(), docVars(cwd))}`
    const destination = path.join(cwd, copy.to)
    if (!existsSync(destination)) {
      writeFileSync(destination, wanted)
      written.push(copy.to)
      enrolled.add(copy.name)
    } else if (readFileSync(destination).toString() === wanted) {
      enrolled.add(copy.name)
    } else if (args.docs) {
      // Asked for: the standard's text replaces the package's own, and git shows exactly what changed.
      writeFileSync(destination, wanted)
      written.push(`${copy.to} (replaced with the standard's)`)
      enrolled.add(copy.name)
    } else {
      differing.push(copy)
    }
  }
  const surfacePath = path.join(cwd, "docs", "surface.json")
  const agents = path.join(cwd, "AGENTS.md")
  const markers = ["<!-- ipc:begin entry-points -->", "<!-- ipc:end entry-points -->"]
  let agentsText = existsSync(agents) ? readFileSync(agents).toString() : undefined
  if (!existsSync(surfacePath)) {
    const surface = draftSurface(manifest, (relative) => existsSync(path.join(cwd, relative)))
    // A package that already keeps its API map by hand loses none of it: the table seeds the surface, and is
    // replaced by the generated one.
    const table = agentsText === undefined ? undefined : findApiTable(agentsText)
    if (table !== undefined && !agentsText.includes(markers[0])) {
      const seeded = seedFromTable(surface, table, name)
      const lines = agentsText.split("\n")
      lines.splice(table.start, table.end - table.start, ...markers)
      agentsText = lines.join("\n")
      writeFileSync(agents, agentsText)
      written.push(
        `AGENTS.md (its API table is now generated; ${String(seeded)} row(s) seeded docs/surface.json)`,
      )
    }
    mkdirSync(path.dirname(surfacePath), { recursive: true })
    writeFileSync(surfacePath, `${JSON.stringify(surface, null, 2)}\n`)
    written.push("docs/surface.json")
  }
  if (agentsText === undefined) {
    writeIfAbsent("AGENTS.md")
  } else if (!agentsText.includes(markers[0])) {
    writeFileSync(agents, `${agentsText.trimEnd()}\n${REGION}`)
    written.push("AGENTS.md (the API map section)")
  }
  // Every file of the standard's template the package lacks: configs, documents, issue and pull request
  // templates. Source, tests and benchmark suites are the package's own and are never added.
  const SKIPPED =
    /^(src|test|benchmarks|docs\/api-report|\.github\/workflows|\.changeset)\/|^(package\.json|AGENTS\.md|CODEOWNERS|docs\/surface\.json|CODE_OF_CONDUCT\.md|SUPPORT\.md|RELEASING\.md)$/
  for (const relative of listTemplateFiles(templateRoot)) {
    if (!SKIPPED.test(relative)) writeIfAbsent(relative)
  }
  // A shared file the package carries unchanged (whether it had it or was just given it) is enrolled as it is;
  // one it changed, or lacks, is its choice.
  const files = COPIES.filter(
    (copy) =>
      copy.kind === "file" &&
      existsSync(path.join(cwd, copy.to)) &&
      readFileSync(path.join(cwd, copy.to)).toString() ===
        readFileSync(path.join(hooks.packageRoot, copy.from)).toString(),
  ).map((copy) => copy.name)
  const adopted = [...enrolled, ...files]
  if (adopted.length > 0) {
    // What the package already lists stays: running this again must never drop a copy it chose.
    const copies = [...new Set([...(manifest[DEPENDENCY]?.copies ?? []), ...adopted])].sort()
    manifest[DEPENDENCY] = { ...manifest[DEPENDENCY], copies }
    writeManifest()
  }
  if (
    !alreadyAdopted &&
    !args.strict &&
    !existsSync(path.join(cwd, ".repo-contract", "adoption.json"))
  ) {
    writeAdoption(cwd, newAdoption())
    written.push(
      ".repo-contract/adoption.json (adoption mode: failures are reported but do not fail the run until you promote the check)",
    )
  }
  io.out(
    `[init] added to package.json: ${["scripts", "devDependencies", "overrides"].map((field) => `${String(additions[field].length)} ${field}`).join(", ")}\n`,
  )
  io.out(`[init] wrote ${written.length === 0 ? "nothing more" : written.join(", ")}\n`)
  for (const copy of differing) {
    io.out(
      `[init] ${copy.to} differs from the standard's, so it was left as it is. \`${DEPENDENCY} sync --add ${copy.name}\` adopts the standard's.\n`,
    )
  }

  if (!step("generate the API map", "node", [bin("contract.mjs"), "generate"])) return 1
  // Nothing about the environment is required, so documenting it never stops the adoption.
  step("document the environment", "node", [bin("contract.mjs"), "env"], true)
  // A package that already has a landing page gets it regenerated, so it matches the standard's shared assets.
  if (existsSync(path.join(cwd, "docs", "site.json"))) {
    step("regenerate the landing page", "node", [bin("contract.mjs"), "site"], true)
  }
  io.out("\n")
  spawn("node", [bin("contract.mjs"), "doctor"], cwd)
  io.out(
    `\n[init] done. Review the changes, then run \`npm run contract\` to see what the standard finds, and commit.\n`,
  )
  return 0
}
