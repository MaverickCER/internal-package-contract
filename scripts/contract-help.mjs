// The usage text of `internal-package-contract`. Kept out of the dispatcher so the public surface the
// SurfaceContract check snapshots (this text) is tested, and so `--help` never reaches code that would
// run the contract.
//
// One table describes every command: the overview groups them by what a person is doing, and
// `internal-package-contract <command> --help` prints that command's own page from the same entry, so the two
// cannot disagree.

/** The `init` options whose next argument is their value, so a `-h` there is a value and not a request for help. */
const INIT_VALUE_OPTIONS = ["--name", "--owner", "--description", "--tag", "--spec"]

/**
 * @typedef {object} Command
 * @property {string} name - what is typed after `internal-package-contract`.
 * @property {"Start" | "Daily" | "Maintain"} group
 * @property {string} usage - the synopsis, without the program name.
 * @property {string} summary - one line for the overview.
 * @property {string} details - what it does, as a short paragraph.
 * @property {readonly (readonly [string, string])[]} [options] - each option and what it does.
 */

/** @type {readonly Command[]} */
export const COMMANDS = [
  {
    name: "init",
    group: "Start",
    usage: "init [--name <package>] [options]",
    summary: "bring the package here under the standard, or start a new one with --name <package>",
    details:
      "In an existing package: adds the pin and the scripts and tools the checks need, installs, writes every config,\nworkflow, document and template the package lacks (never overwriting one it has), drafts docs/surface.json,\nstarts adoption mode and generates the API map. With --name, in an empty directory: scaffolds a complete new\npackage. It refuses to start over uncommitted changes and ends with `doctor`. Running it again finishes what is\nmissing.",
    options: [
      ["--name <package>", "start a new package in this empty directory"],
      ["--owner <owner>", "the GitHub owner of the repository (default: its remote)"],
      ["--description <text>", "the new package's description"],
      ["--tag vX.Y.Z", "the release to pin (default: the latest)"],
      ["--spec <spec>", "pin exactly this dependency spec, for a fork or a local copy"],
      ["--strict", "skip adoption mode: every check can fail the run from the start"],
      ["--github", "also apply branch protection through the gh CLI"],
      ["--docs", "replace a shared document the package has with the standard's"],
      ["--force", "overwrite scaffolded files that already exist"],
      ["--dry-run", "print the plan and change nothing"],
    ],
  },
  {
    name: "doctor",
    group: "Start",
    usage: "doctor",
    summary: "what is set up, what to run next, and the steps only a person can take",
    details:
      "Read-only. Lists what is in place, the command that fixes each thing that is missing, and the steps that\ncannot be scripted (npm's trusted publisher, repository settings, review apps) with the exact values to enter.\nExits 1 while anything is left to run.",
  },
  {
    name: "(none)",
    group: "Daily",
    usage:
      "[--checks a,b] [--skip a,b] [--strict | --no-strict] [--changed] [--json] [--logs <mode>]",
    summary: "run the whole contract",
    details:
      "Runs every check, prints the verdict, and writes reports/contract/. While a package is adopting the standard\nonly promoted checks can fail the run.",
    options: [
      ["--checks a,b", "run only checks a and b (and what they depend on)"],
      ["--skip a,b", "run every check except a and b"],
      ["--changed", "run only the checks the changed files can affect"],
      ["--json", "print the report as JSON on stdout and nothing else"],
      ["--logs <mode>", "write a log per check: all, failing or off (default: failing)"],
      [
        "--strict",
        'also fail on a "not evaluated" result no exception covers (the default under CI)',
      ],
      ["--no-strict", "turn --strict off under CI"],
    ],
  },
  {
    name: "generate",
    group: "Daily",
    usage: "generate [--check]",
    summary: "write the generated regions of the documents from package.json and docs/surface.json",
    details:
      "Rewrites only what is between the <!-- ipc:begin ... --> and <!-- ipc:end ... --> markers of the documents it\nreads, formatted with the package's own Prettier settings.",
    options: [["--check", "write nothing; fail and name what is stale"]],
  },
  {
    name: "skill",
    group: "Daily",
    usage: "skill [--check]",
    summary:
      "write the package's agent skill: a short manual an AI loads, and a reference of every public signature",
    details:
      "Writes skills/<name>/SKILL.md and skills/<name>/references/api.md from docs/skill.json (what only the author knows:\nwhen it applies, one example, the rules, the mistakes that matter) and what the package already holds (its entry points,\nits public API, its version). The manual has a word budget, so an agent can load it whole; everything longer is a link.\nPrints the address to give an agent.",
    options: [["--check", "write nothing; fail and name what is stale, over budget or broken"]],
  },
  {
    name: "mutation",
    group: "Daily",
    usage: "mutation [--base <ref>] [file...]",
    summary: "mutation-test what a change touched, as a fast loop (the full run is the check)",
    details:
      "Runs every mutant of the files the change touched, and of the source files the changed tests import, and nothing\nelse; always every mutant of those files, never an earlier result, under the package's own concurrency. It is advice,\nnot the gate: a mutant in a file nobody touched can be killed by a test that did, so only a full `Mutation` run says a\nchange is finished.",
    options: [
      ["--base <ref>", "what the change is measured against (default: origin/main, else main)"],
      ["file...", "mutate exactly these files instead"],
    ],
  },
  {
    name: "report",
    group: "Daily",
    usage: "report [--base <ref>] [--out <file>]",
    summary: "what this change does to the package, as Markdown to paste into a pull request",
    details:
      "Reads git, the pending changesets, the exception registries, the decision records, the manifest and the contract's\nlast report, and says what changed, what it means for a release, and what the checks said. Nothing is written by hand.\nRun the contract first so the report can say what the checks found.",
    options: [
      ["--base <ref>", "what to measure against (default: origin/main, else main)"],
      ["--out <file>", "write the report to a file instead of printing it"],
    ],
  },
  {
    name: "verify-consumers",
    group: "Maintain",
    usage: "verify-consumers <checkout>... [--skip a,b] [--keep]",
    summary:
      "check that this version of the standard does not make a package that depends on it worse",
    details:
      "For each checkout, runs its contract's fast offline checks twice in throwaway copies, once with the standard it has\ninstalled and once with this one, and reports every check that got worse. A check that fails both ways was already failing\nand is not blamed on the change. The checkout itself is never touched.",
    options: [
      ["--skip a,b", "also leave these checks out"],
      ["--keep", "keep the throwaway copies, to look at what ran"],
    ],
  },
  {
    name: "env",
    group: "Daily",
    usage: "env [--check | --rotation-issue]",
    summary: "document the variables and secrets the package needs, from ci/env.schema.ts",
    details:
      "Writes docs/ENVIRONMENT.md from ci/env.schema.ts, with env-cap, which this package carries.\nNothing is required: no schema means nothing to document, and a missing owner or expiry date is a warning.",
    options: [
      ["--check", "write nothing; fail and name what is stale"],
      [
        "--rotation-issue",
        "open, update or close the GitHub issue for credentials due for rotation",
      ],
    ],
  },
  {
    name: "tool",
    group: "Daily",
    usage: "tool <name> [args]",
    summary:
      "run a build or release helper: size, badges, api-report, cjs-interop, compiler-isolation",
    details:
      "The helpers every package used to copy: `size` checks the gzip budgets in ci/size-budgets.mjs, `badges` writes the coverage and size badges,\n`api-report` fails when docs/api-report/ is out of date, `cjs-interop` makes require() of the ESLint plugin return the plugin,\nand `compiler-isolation` fails when a client entry can reach the bundled compiler. Run one from the package's root.",
    options: [["size --json <file>", "also write the measured sizes, which `badges` reads"]],
  },
  {
    name: "add",
    group: "Daily",
    usage: "add export <name> [--dry-run] | add check <Name> [--dry-run]",
    summary:
      "wire a new subpath export into every place that lists one, or turn on an optional check",
    details:
      "`add export` edits package.json exports, the bundler entry, the declaration shim, the documentation entry points, the\ndead-code entry and docs/surface.json, and creates the module, its test and a draft changeset.\n`add check AmbientCapabilities` names the check in package.json, with its settings written out to change.",
    options: [["--dry-run", "print what would be written and change nothing"]],
  },
  {
    name: "new",
    group: "Daily",
    usage: 'new adr "<title>"',
    summary: "start a decision record with the next number, its sections and prompts",
    details:
      "Writes the next numbered record in specs/decisions (or docs/decisions, docs/adr) with each section's prompt.\nThe prompts fail a release until they are answered.",
  },
  {
    name: "promote",
    group: "Daily",
    usage: "promote <Check>... | --all",
    summary: "make a check fail the run; --all ends adoption mode",
    details:
      "While a package is adopting the standard a failing check is reported but does not fail the run. Promoting a\ncheck makes its failure fail the run from then on. --all ends adoption mode.",
  },
  {
    name: "upgrade",
    group: "Maintain",
    usage: "upgrade <vX.Y.Z>",
    summary: "move to a release and bring everything it owns up to date",
    details:
      "Installs the release, re-pins the workflows that call its reusable workflows, brings the managed files up to\ndate, regenerates the landing page and copies the benchmark guides. It stops at the first step that fails.",
  },
  {
    name: "sync",
    group: "Maintain",
    usage: "sync [--apply [--update]] [--add <copy>]",
    summary: "report the files this package owns that are missing or drifted",
    details:
      "Compares the files the standard owns here (workflows, the Changesets config, shared code and documents) with\nthe standard's, and shows what differs.",
    options: [
      ["--apply", "write the files that are missing"],
      ["--update", "with --apply, also replace the files that drifted"],
      ["--add <copy>", "start carrying a managed copy of shared code or a shared document"],
    ],
  },
  {
    name: "site",
    group: "Maintain",
    usage: "site [--check] [--content <file>] [--out <dir>]",
    summary: "generate the landing page and one-page brief from docs/site.json",
    details: "Writes index.html, brief.html, styles.css and script.js from docs/site.json.",
    options: [["--check", "write nothing; fail and name what is stale"]],
  },
  {
    name: "exceptions",
    group: "Maintain",
    usage: "exceptions",
    summary: "list every exception registry: counts by type, legacy, expired",
    details: "Read-only inventory of the records in .repo-contract/exceptions.",
  },
  {
    name: "update-baseline",
    group: "Maintain",
    usage: "update-baseline",
    summary: "regenerate the API and surface baselines after a release",
    details:
      "Rewrites the committed baselines the ApiContract and SurfaceContract checks compare against.",
  },
  {
    name: "sync-benchmark-guides",
    group: "Maintain",
    usage: "sync-benchmark-guides",
    summary: "copy the canonical benchmark guides into benchmarks/",
    details: "Writes the shared guides that explain how to write and how to read the benchmarks.",
  },
  {
    name: "install-hooks",
    group: "Maintain",
    usage: "install-hooks",
    summary: "point git at the bundled hooks (once per clone)",
    details: "Sets core.hooksPath to the standard's hooks. Never run by an install script.",
  },
]

/**
 * @param {readonly string[]} argv - the arguments after the script name.
 * @returns {boolean} whether help was asked for; the value of an `init` option never counts.
 */
export function wantsHelp(argv) {
  const isInit = argv[0] === "init"
  return argv.some(
    (arg, index) =>
      (arg === "--help" || arg === "-h") &&
      !(isInit && INIT_VALUE_OPTIONS.includes(argv[index - 1])),
  )
}

const pad = (text, width) => text.padEnd(width)

/** @returns {string} the overview: every command, grouped by what a person is doing, then the run options. */
export function helpText() {
  const width = 26
  const lines = ["Usage: internal-package-contract [command] [options]", ""]
  for (const group of ["Start", "Daily", "Maintain"]) {
    lines.push(`${group}:`)
    for (const command of COMMANDS.filter((item) => item.group === group)) {
      lines.push(`  ${pad(command.name, width)} ${command.summary}`)
    }
    lines.push("")
  }
  lines.push(
    "Run `internal-package-contract <command> --help` for a command's options.",
    "",
    "Options (when running the contract):",
    ...COMMANDS.find((item) => item.name === "(none)").options.map(
      ([option, text]) => `  ${pad(option, width)} ${text}`,
    ),
    `  ${pad("-h, --help", width)} print this text and exit`,
    "",
  )
  return lines.join("\n")
}

/**
 * @param {string | undefined} name - a command name as typed.
 * @returns {string | undefined} that command's own page, or `undefined` when there is no such command.
 */
export function commandHelp(name) {
  const command = COMMANDS.find((item) => item.name === name)
  if (command === undefined) return undefined
  const lines = [`Usage: internal-package-contract ${command.usage}`, "", command.details]
  if (command.options !== undefined) {
    lines.push(
      "",
      "Options:",
      ...command.options.map(([option, text]) => `  ${pad(option, 24)} ${text}`),
    )
  }
  lines.push("")
  return lines.join("\n")
}

/**
 * @param {string} a - one word.
 * @param {string} b - another.
 * @returns {number} how many single-character edits turn one into the other.
 */
function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (const [i, left] of [...a].entries()) {
    const row = [i + 1]
    for (const [j, right] of [...b].entries()) {
      row.push(Math.min(previous[j + 1] + 1, row[j] + 1, previous[j] + (left === right ? 0 : 1)))
    }
    previous = row
  }
  return previous[b.length]
}

/**
 * @param {string} word - what was typed.
 * @param {readonly string[]} names - what it could have been.
 * @returns {string | undefined} the closest name, when it is close enough to be a likely typo.
 */
export function nearest(word, names) {
  const [closest] = names
    .map((name) => ({ name, away: distance(word.toLowerCase(), name.toLowerCase()) }))
    .sort((a, b) => a.away - b.away)
  return closest !== undefined && closest.away <= 3 ? closest.name : undefined
}

/**
 * A word that is not an option and not a command would otherwise start the whole contract, which can run for
 * hours, on what is almost certainly a typo.
 * @param {readonly string[]} argv - the arguments after the script name.
 * @returns {string | undefined} what to tell the person, or `undefined` when the arguments name a command or an option.
 */
export function unknownCommand(argv) {
  const word = argv[0]
  if (word === undefined || word.startsWith("-")) return undefined
  const names = COMMANDS.map((item) => item.name).filter((name) => name !== "(none)")
  if (names.includes(word)) return undefined
  const closest = nearest(word, names)
  const hint = closest === undefined ? "" : ` Did you mean \`${closest}\`?`
  return `internal-package-contract: "${word}" is not a command.${hint} Run \`internal-package-contract --help\` to see them.\n`
}
