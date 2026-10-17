// `internal-package-contract doctor`: what is set up in this package, and what is left to do.
//
// Read-only. It looks at the files and git settings that adopting this standard puts in place, runs the cheap
// checks that say whether they are current (managed files, generated regions, the landing page, prompts), and
// lists the steps only a person can take, with the exact values to enter. It says what to run next for each
// thing that is missing. It never changes anything and never calls the network.

import { existsSync, lstatSync, readFileSync } from "node:fs"
import path from "node:path"
import { repositoryOwner } from "../repository-owner.mjs"
import { readAdoption } from "../adoption/mode.mjs"
import { run as generate } from "../generate/run.mjs"
import { inspectManaged, enrolledCopies } from "../managed-files/inspect.mjs"
import { gitIn } from "../changed.mjs"
import { inspectEnv, SCHEMA_PATH } from "../env/run.mjs"
import { scanPackage } from "../prompts/scan.mjs"
import { run as renderSite } from "../site/render-site.mjs"

const DEPENDENCY = "internal-package-contract"
// A pin is only wording as far as the meaning of a managed file goes, and only the state of each file is read here.
// Stryker disable next-line ObjectLiteral,StringLiteral: equivalent -- no pin can change a file's state.
const NO_PIN = { ipcRef: "", ipcSha: "" }
const WORKFLOWS = [
  ["release.yml", "publishes the package"],
  ["scorecard.yml", "publishes the OpenSSF Scorecard result"],
  ["sync-internal-package-contract.yml", "keeps the pin current"],
]

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {"ok" | "todo" | "manual"} state - `manual` is a step only a person can take.
 * @property {string} what - one line saying what was found.
 * @property {string} [fix] - what to run or do next.
 */

/**
 * @param {string} cwd
 * @returns {Record<string, any> | undefined} the package's manifest, if it has a readable one.
 */
function readManifest(cwd) {
  try {
    return JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
  } catch (error) {
    // A missing file and a file that is not JSON are findings; anything else (no permission, a folder) is not.
    if (error instanceof SyntaxError || error.code === "ENOENT") return undefined
    throw error
  }
}

/**
 * @param {object} input
 * @param {string} input.cwd - the package root.
 * @param {string} input.packageRoot - this package's root (where the standard's templates are).
 * @param {(args: string[]) => string | undefined} [input.git] - runs git in `cwd`, returning trimmed stdout or undefined; a test seam.
 * @returns {Promise<Item[]>} everything the standard expects, in the order a person would fix it.
 */
export async function diagnose({ cwd, packageRoot, git = gitIn(cwd) }) {
  /** @type {Item[]} */
  const items = []
  const manifest = readManifest(cwd)
  if (manifest === undefined) {
    return [
      {
        id: "package",
        state: "todo",
        what: "There is no readable package.json here.",
        fix: "Run `npx github:MaverickCER/internal-package-contract init --name <package>` in an empty directory to start a package, or run this in an existing package.",
      },
    ]
  }

  const dependency = manifest.devDependencies?.[DEPENDENCY] ?? manifest.dependencies?.[DEPENDENCY]
  items.push(
    dependency === undefined
      ? {
          id: "dependency",
          state: "todo",
          what: `${DEPENDENCY} is not a dependency of this package.`,
          fix: "Run `internal-package-contract init`.",
        }
      : { id: "dependency", state: "ok", what: `${DEPENDENCY} is pinned: ${String(dependency)}.` },
  )
  items.push(
    manifest.scripts?.contract === DEPENDENCY
      ? { id: "script", state: "ok", what: 'The "contract" script runs the standard.' }
      : {
          id: "script",
          state: "todo",
          what: 'package.json has no "contract" script that runs the standard.',
          fix: 'Add `"contract": "internal-package-contract"` to its scripts, or run `internal-package-contract init`.',
        },
  )

  const missingWorkflows = WORKFLOWS.filter(
    ([file]) => !existsSync(path.join(cwd, ".github", "workflows", file)),
  )
  items.push(
    missingWorkflows.length === 0
      ? {
          id: "workflows",
          state: "ok",
          what: "The release, Scorecard and pin-sync workflows exist.",
        }
      : {
          id: "workflows",
          state: "todo",
          what: `Missing workflows: ${missingWorkflows.map(([file, why]) => `${file} (${why})`).join(", ")}.`,
          fix: "Run `npm install` so the lockfile pins a commit, then `internal-package-contract init` (it writes only what is missing).",
        },
  )

  // A symlinked install makes the standard resolve its own tools from the wrong node_modules, which fails in
  // ways that look like bugs in the package (a missing typedoc, a duplicated ESLint plugin).
  const installedPath = path.join(cwd, "node_modules", DEPENDENCY)
  if (existsSync(installedPath) && lstatSync(installedPath).isSymbolicLink()) {
    items.push({
      id: "install",
      state: "todo",
      what: `${DEPENDENCY} is installed as a symlink, so it resolves its own tools from its own node_modules and checks can fail for reasons that are not in this package.`,
      fix: `Install a copy instead: \`npm install --install-links --save-dev file:<path to ${DEPENDENCY}>\`.`,
    })
  }

  // Hooks resolve their paths from the repository's top level, which is the main checkout's, not a linked
  // worktree's: commits and pushes made from one can run the wrong hook or the wrong copy of the standard.
  const gitDirectory = git(["rev-parse", "--path-format=absolute", "--git-dir"])
  const commonDirectory = git(["rev-parse", "--path-format=absolute", "--git-common-dir"])
  if (
    gitDirectory !== undefined &&
    commonDirectory !== undefined &&
    gitDirectory !== commonDirectory
  ) {
    items.push({
      id: "worktree",
      state: "todo",
      what: "This is a linked git worktree. The bundled hooks can run the wrong hook, or the wrong copy of the standard, from here.",
      fix: "Make the commit or push from the main checkout (for a push, `git push origin <branch>:<branch>`), or work in a separate clone.",
    })
  }

  const hooksPath = git(["config", "core.hooksPath"])
  items.push(
    hooksPath !== undefined && hooksPath.includes(DEPENDENCY)
      ? { id: "hooks", state: "ok", what: "git runs the standard's hooks." }
      : {
          id: "hooks",
          state: "todo",
          what: "git is not set up to run the standard's hooks, so a change is not checked before it is committed.",
          fix: "Run `internal-package-contract install-hooks` once in this clone.",
        },
  )

  if (dependency !== undefined && existsSync(path.join(packageRoot, "template"))) {
    const states = inspectManaged({ cwd, packageRoot, pins: NO_PIN }).filter(
      (entry) => entry.state !== "current",
    )
    items.push(
      states.length === 0
        ? {
            id: "managed",
            state: "ok",
            what: `Every file the standard owns here (${String(enrolledCopies(cwd).length)} copies and documents) is current.`,
          }
        : {
            id: "managed",
            state: "todo",
            what: `${String(states.length)} managed file(s) are missing or drifted: ${states.map((entry) => entry.to).join(", ")}.`,
            fix: "Run `internal-package-contract sync` to see the difference and `sync --apply --update` to restore them.",
          },
    )
  }

  const regionMessages = []
  const regionCode = await generate(["--check"], cwd, {
    out: (text) => regionMessages.push(text.trim()),
    err: (text) => regionMessages.push(text.trim()),
  })
  items.push(
    regionCode === 0
      ? { id: "regions", state: "ok", what: regionMessages.toString() }
      : {
          id: "regions",
          state: "todo",
          what: regionMessages.toString(),
          fix: "Run `internal-package-contract generate`.",
        },
  )

  if (existsSync(path.join(cwd, "docs", "site.json"))) {
    const messages = []
    const collect = (/** @type {string} */ text) => messages.push(text.trim())
    const code = await renderSite(["--check"], cwd, { out: collect, err: collect })
    items.push(
      code === 0
        ? { id: "site", state: "ok", what: "The landing page matches docs/site.json." }
        : {
            id: "site",
            state: "todo",
            what: messages.toString(),
            fix: "Run `internal-package-contract site`.",
          },
    )
  } else {
    items.push({
      id: "site",
      state: "todo",
      what: "There is no docs/site.json, so the package has no generated landing page.",
      fix: 'Write docs/site.json (the README\'s "Landing page" section lists what it needs), then run `internal-package-contract site`.',
    })
  }

  const env = await inspectEnv({ cwd })
  const envProblems = [
    ...env.findings.map((finding) => finding.message),
    ...env.stale.map((file) => `${file} is out of date`),
  ]
  items.push(
    env.state === "absent"
      ? {
          id: "env",
          state: "ok",
          what: `There is no ${SCHEMA_PATH}, and none is required: it documents the credentials the workflows use and when they expire.`,
        }
      : envProblems.length === 0
        ? {
            id: "env",
            state: "ok",
            what: `${String(env.contracts)} environment contract(s) documented, and the generated files are current.`,
          }
        : {
            id: "env",
            state: "todo",
            what: `The environment contract has ${String(envProblems.length)} thing(s) to look at: ${envProblems.join("; ")}.`,
            fix: "Rotate what is expiring and update its `expiresAt`, then run `internal-package-contract env`.",
          },
  )

  const prompts = scanPackage(cwd)
  items.push(
    prompts.length === 0
      ? { id: "prompts", state: "ok", what: "No document still asks its author a question." }
      : {
          id: "prompts",
          state: "todo",
          what: `${String(prompts.length)} unanswered prompt(s), starting with ${prompts[0].file}:${String(prompts[0].line)}. A release fails until they are answered.`,
          fix: "Answer each by replacing its whole comment (or its `TODO:` value) with the answer.",
        },
  )

  const adoption = readAdoption(cwd)
  if (adoption.state === "active") {
    items.push({
      id: "adoption",
      state: "todo",
      what: `Adoption mode is on until ${String(adoption.expiresAt)} (${String(adoption.daysLeft)} day(s) left): a failing check reports its error without failing the run, and ${adoption.enforce.length ? `${adoption.enforce.join(", ")} enforce` : "nothing enforces yet"}.`,
      fix: "Run `npm run contract`, fix a check, then `internal-package-contract promote <Check>`. `promote --all` ends adoption mode.",
    })
  } else if (adoption.state === "expired" || adoption.state === "invalid") {
    items.push({
      id: "adoption",
      state: "todo",
      what:
        adoption.state === "expired"
          ? `The adoption period ended on ${String(adoption.expiresAt)}.`
          : String(adoption.problem),
      fix: "Run `internal-package-contract promote --all` so every check enforces.",
    })
  } else {
    items.push({
      id: "adoption",
      state: "ok",
      what: "Every check can fail the run (not in adoption mode).",
    })
  }

  const name = typeof manifest.name === "string" ? manifest.name : "<package>"
  const repo = name.slice(name.indexOf("/") + 1)
  const owner = repositoryOwner(manifest.repository)
  items.push(
    {
      id: "trusted-publisher",
      state: "manual",
      what: "npm's trusted publisher is registered on npmjs.com, which only the package's owner can do.",
      fix: `On npmjs.com, open ${name} > Settings > Trusted Publisher > GitHub Actions: organization or user \`${(owner ?? "<owner>").toLowerCase()}\`, repository \`${repo}\`, workflow \`release.yml\`, environment blank. A package that is not on npm yet needs its first publish by hand.`,
    },
    {
      id: "repository",
      state: "manual",
      what: "Branch protection and Actions settings live on GitHub.",
      fix: "Run `gh auth login` and then `internal-package-contract init --github` to apply branch protection; in Settings > Actions > General allow Actions to create pull requests. The BranchProtection check verifies the result.",
    },
    {
      id: "apps",
      state: "manual",
      what: "Review and scanning services are installed on the repository, not in it.",
      fix: "Install the CodeRabbit and Socket apps on the repository. Add a SOCKET_SECURITY_API_KEY secret for the Socket scan. Optionally add a PIN_SYNC_TOKEN secret (a fine-grained token with Contents, Pull requests and Workflows write access) so pin-sync pull requests can change workflow files.",
    },
  )
  return items
}

/**
 * @param {Item[]} items
 * @returns {string} the report: what is done, what to run, and what only a person can do.
 */
export function renderReport(items) {
  const mark = { ok: "ok    ", todo: "TODO  ", manual: "MANUAL" }
  const lines = items.map(
    (item) => `[${mark[item.state]}] ${item.what}${item.fix ? `\n         -> ${item.fix}` : ""}`,
  )
  const todo = items.filter((item) => item.state === "todo").length
  const manual = items.filter((item) => item.state === "manual").length
  lines.push(
    "",
    todo === 0
      ? `Nothing left to run. ${String(manual)} step(s) only a person can take are listed above.`
      : `${String(todo)} thing(s) to run, then ${String(manual)} step(s) only a person can take.`,
  )
  return `${lines.join("\n")}\n`
}

/**
 * @param {readonly string[]} argv
 * @param {string} cwd
 * @param {string} packageRoot
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {Promise<number>} 0 when nothing is left to run, 1 otherwise; the manual steps never change it.
 */
export async function run(argv, cwd, packageRoot, io) {
  if (argv.length > 0) {
    io.err(`[doctor] unknown argument: ${argv[0]}\nUsage: internal-package-contract doctor\n`)
    return 2
  }
  const items = await diagnose({ cwd, packageRoot })
  io.out(renderReport(items))
  return items.some((item) => item.state === "todo") ? 1 : 0
}
