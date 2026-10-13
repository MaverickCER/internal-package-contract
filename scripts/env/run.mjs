// `internal-package-contract env`: documents the environment variables and secrets a package depends on, from
// `ci/env.schema.ts`, with env-cap (which this package carries, so the package installs nothing extra).
//
// None of it is required. A package with no `ci/env.schema.ts` has nothing to document and is told so; a variable
// with no expiry date or no owner is reported as a warning; nothing here fails a run on its own except asking
// `--check` whether the generated files are current. The schema is only ever read, never executed (env-cap parses
// it), and the files written are documentation: no manifest is generated, so nothing ships in a package.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { format, resolveConfig } from "prettier"
import { captureCommand } from "../init/existing.mjs"

/** Where a package keeps the description of what it needs from its environment. */
export const SCHEMA_PATH = "ci/env.schema.ts"
export const DOCS_PATH = "docs/ENVIRONMENT.md"
/** The label of the issue that says a credential is due for rotation. */
export const ISSUE_LABEL = "env-rotation"
const USAGE = "Usage: internal-package-contract env [--check | --rotation-issue]\n"

/**
 * @returns {Promise<import("./run.mjs").EnvCapModule>}
 *   env-cap's build functions and the Node filesystem they are given.
 */
export async function loadEnvCap() {
  const [build, node] = await Promise.all([
    import("@maverickcer/env-cap/build"),
    import("@maverickcer/env-cap/node"),
  ])
  return { ...build, fs: node.nodeBuildFileSystem }
}

/**
 * env-cap also reads every `.ts` file under the root to say who uses each variable, and gives up past a thousand of
 * them. Only the contract is wanted here, so everything outside `ci/` is left out (a package's sources and tests can
 * run to thousands of files).
 * @param {string} cwd - the package root.
 * @returns {string[]} one pattern per top-level entry other than `ci`.
 */
function outsideContract(cwd) {
  return readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => entry.name !== "ci")
    .map((entry) => (entry.isDirectory() ? `${entry.name}/**` : entry.name))
}

/** The package that ships the contract for what the standard itself reads from the environment. */
export const STANDARD_PACKAGE = "internal-package-contract"

/**
 * What the standard reads from the environment (the tokens its checks use, its tool settings) is documented once, by
 * the standard, in the contract it ships. A package takes that in rather than writing it again, so the explanation
 * and the variable names cannot drift. The standard has no one to take it from: it is that contract.
 * @param {string} cwd - the package root.
 * @returns {string[]} the packages whose contracts are part of this package's.
 */
function shippedContracts(cwd) {
  const manifest = path.join(cwd, "package.json")
  const name = existsSync(manifest) ? JSON.parse(readFileSync(manifest).toString()).name : undefined
  // Stryker disable next-line ArrayDeclaration: equivalent -- a package that is not installed contributes no contract, so a placeholder name changes nothing.
  return name === STANDARD_PACKAGE ? [] : [STANDARD_PACKAGE]
}

/** @param {string} cwd @param {{ fs: object }} envCap @returns {object} the options every env-cap call shares. */
function shared(cwd, envCap) {
  return {
    fs: envCap.fs,
    root: cwd,
    include: [SCHEMA_PATH],
    exclude: outsideContract(cwd),
    packages: shippedContracts(cwd),
    tsconfig: false,
    docs: { location: DOCS_PATH },
    // The evidence model is not persisted: it embeds the days a credential has left, so it would be stale every day.
    evidence: false,
  }
}

/** The line env-cap stamps into a generated document; it changes whenever the document is made. */
const STAMP = /^_Generated .*_$/m
/**
 * The section env-cap fills by comparing the contract with the document already on disk. It says what changed since
 * that document was written, so right after writing it reads "No changes." and before that it lists what was added:
 * it differs between two runs over the same contract, and says nothing the rest of the document does not.
 */
const CHANGES = /^## Changes since last report\n[\s\S]*?(?=^## )/m

/** @param {string} text - a generated document. @returns {string} it without what differs between two runs over the same contract. */
// Stryker disable next-line StringLiteral: equivalent -- both documents are settled the same way, so any one replacement text leaves them equal exactly when they were.
const settled = (text) => text.replace(STAMP, "").replace(CHANGES, "")

/**
 * env-cap's document as it is breaks two of the rules the standard's own Markdown check applies (a blank line between
 * two quoted paragraphs, and a URL that is not a link), so the same text is rewritten to say the same thing without
 * them. Text inside a code span is left exactly as it is.
 * @param {string} text - the document env-cap rendered.
 * @returns {string} the document, as it should be written.
 */
export function lintFriendly(text) {
  return text
    .replace(/^(>.*)\n\n(?=>)/gm, "$1\n>\n")
    .split(/(`[^`\n]*`)/)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/(?<!\]\()(?<![<\w])https?:\/\/[^\s)>]+/g, "<$&>"),
    )
    .join("")
}

/**
 * @param {string} platform - `process.platform`.
 * @returns {boolean} whether a path may be written in either case on it: on Windows it may.
 */
export function isCaseless(platform) {
  return platform === "win32"
}

/**
 * Says a document from the package root, the same on every machine: the folder the package lives in is taken out of
 * every path, and the source of a shipped contract is written with `/`.
 * @param {string} text - the generated document.
 * @param {string[]} roots - the package folder as it may be written (the real one, the resolved one).
 * @param {string} separator - the platform's path separator.
 * @param {boolean} caseless - whether a path may be written in either case, as on Windows.
 * @returns {string} the document without the machine in it.
 */
export function withoutMachine(text, roots, separator, caseless) {
  const stripped = roots
    .map((root) => `${root}${separator}`)
    .reduce(
      (rest, root) =>
        rest.replace(
          new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseless ? "gi" : "g"),
          "",
        ),
      text,
    )
  return stripped.replace(
    /(Source: `)([^`]+)(`)/g,
    (_all, open, source, close) => `${open}${String(source).replaceAll("\\", "/")}${close}`,
  )
}

/**
 * What `docs/ENVIRONMENT.md` should say, formatted the way the package's own Prettier settings want, so the Format
 * check never disagrees with it, and the evidence it was made from. Computed in memory: nothing is written.
 * @param {string} cwd
 * @param {import("./run.mjs").EnvCapModule} envCap
 * @returns {Promise<{ expected: string, evidence: { contract: { contracts: readonly unknown[] }, finding: { findings: readonly { family: string, severity: string, code: string, message: string }[] } } }>}
 */
async function renderDocs(cwd, envCap) {
  /** @type {Map<string, string>} */
  const written = new Map()
  const fs = {
    ...envCap.fs,
    // Stryker disable next-line ArrowFunction: equivalent -- the stand-in must create nothing, and a function returning nothing creates nothing too.
    mkdir: () => Promise.resolve(),
    writeFile: (/** @type {string} */ file, /** @type {string} */ text) => {
      written.set(path.resolve(file), text)
      return Promise.resolve()
    },
  }
  const { evidence } = await envCap.generateEnvArtifacts({ ...shared(cwd, envCap), fs })
  const raw = written.get(path.resolve(cwd, DOCS_PATH))
  const file = path.join(cwd, DOCS_PATH)
  // A contract a package ships is read from where it is installed, and env-cap writes that place as an absolute
  // path (the real one, not the one it was given), which differs on every machine. Said from the package root it is
  // the same everywhere.
  const slashed = withoutMachine(
    raw,
    [realpathSync(cwd), realpathSync.native(cwd), path.resolve(cwd)],
    path.sep,
    isCaseless(process.platform),
  )
  const expected = await format(lintFriendly(slashed), {
    ...(await resolveConfig(file)),
    parser: "markdown",
  })
  return { expected, evidence }
}

/**
 * Reads the contract and says what is wrong with it and with the files generated from it. Writes nothing.
 * @param {object} input
 * @param {string} input.cwd - the package root.
 * @param {() => Promise<any>} [input.load] - how env-cap is loaded; a test seam.
 * @returns {Promise<{ state: "absent" | "present", contracts: number, findings: { severity: string, code: string, message: string }[], stale: string[], expected?: string }>}
 */
export async function inspectEnv({ cwd, load = loadEnvCap }) {
  const envCap = await load()
  // One pass: the same run that renders the document also yields the evidence its findings come from.
  const { expected, evidence } = await renderDocs(cwd, envCap)
  const contracts = evidence.contract.contracts.length
  if (contracts === 0) return { state: "absent", contracts, findings: [], stale: [] }
  const findings = evidence.finding.findings
    .filter((finding) => finding.family === "documentation")
    .map(({ severity, code, message }) => ({ severity, code, message }))
  const file = path.join(cwd, DOCS_PATH)
  const actual = existsSync(file) ? readFileSync(file).toString() : undefined
  const stale = actual !== undefined && settled(actual) === settled(expected) ? [] : [DOCS_PATH]
  return { state: "present", contracts, findings, stale, expected }
}

/** @param {{ code: string }} finding @returns {boolean} whether a credential is due for rotation, or past it. */
const dueForRotation = (finding) => finding.code === "EXPIRING_SOON" || finding.code === "EXPIRED"

/**
 * Opens, updates or closes the one issue that says which credentials are due for rotation.
 * @param {{ findings: { code: string, message: string }[] }} report
 * @param {(args: string[]) => { status: number, stdout: string }} gh - runs the GitHub CLI.
 * @returns {string} what was done, in a sentence.
 */
export function syncRotationIssue(report, gh) {
  const due = report.findings.filter(dueForRotation)
  const listed = gh([
    "issue",
    "list",
    "--label",
    ISSUE_LABEL,
    "--state",
    "open",
    "--json",
    "number",
    "--jq",
    ".[0].number",
  ])
  if (listed.status !== 0)
    return "could not ask GitHub about the rotation issue, so none was changed."
  const open = listed.stdout.trim()
  if (due.length === 0) {
    if (open === "") return "no credential is due for rotation, and no issue is open."
    gh(["issue", "close", open, "--comment", "Nothing is due for rotation any more."])
    return `no credential is due for rotation, so issue #${open} was closed.`
  }
  const body = [
    "These credentials are expiring or have expired. Rotate each as its `refreshInstructions` say, then update its `expiresAt` in `ci/env.schema.ts`:",
    "",
    ...due.map((finding) => `- ${finding.message}`),
  ].join("\n")
  if (open === "") {
    gh([
      "label",
      "create",
      ISSUE_LABEL,
      "--description",
      "A credential is due for rotation",
      "--force",
    ])
    const created = gh([
      "issue",
      "create",
      "--title",
      "Credentials are due for rotation",
      "--label",
      ISSUE_LABEL,
      "--body",
      body,
    ])
    return created.status === 0
      ? `opened an issue for ${String(due.length)} credential(s) due for rotation.`
      : "could not open the rotation issue."
  }
  const edited = gh(["issue", "edit", open, "--body", body])
  return edited.status === 0
    ? `updated issue #${open}: ${String(due.length)} credential(s) due for rotation.`
    : `could not update issue #${open}.`
}

/**
 * @param {readonly string[]} argv
 * @param {string} cwd - the package root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {{ load?: () => Promise<any>, gh?: (args: string[]) => { status: number, stdout: string } }} [hooks] - test seams.
 * @returns {Promise<number>} 0, or 1 when `--check` finds a generated file out of date; 2 for a bad argument.
 */
export async function run(argv, cwd, io, hooks = {}) {
  const [mode, ...extra] = argv
  if (
    extra.length > 0 ||
    (mode !== undefined && mode !== "--check" && mode !== "--rotation-issue")
  ) {
    io.err(`[env] unknown argument: ${extra[0] ?? mode}\n${USAGE}`)
    return 2
  }
  const report = await inspectEnv({ cwd, load: hooks.load })
  if (report.state === "absent") {
    io.out(
      `[env] there is no ${SCHEMA_PATH}, so there is nothing to document (none is required).\n`,
    )
    return 0
  }
  for (const finding of report.findings) io.out(`[env] ${finding.severity}: ${finding.message}\n`)
  if (mode === "--rotation-issue") {
    io.out(
      `[env] ${syncRotationIssue(report, hooks.gh ?? ((args) => captureCommand("gh", args, cwd)))}\n`,
    )
    return 0
  }
  if (mode === "--check") {
    if (report.stale.length > 0) {
      io.err(
        `[env] stale: ${report.stale.toString()}. Run \`npx internal-package-contract env\` and commit the result.\n`,
      )
      return 1
    }
    io.out("[env] the generated files are current.\n")
    return 0
  }
  if (report.stale.length === 0) {
    io.out(`[env] ${DOCS_PATH} is already current.\n`)
    return 0
  }
  mkdirSync(path.dirname(path.join(cwd, DOCS_PATH)), { recursive: true })
  writeFileSync(path.join(cwd, DOCS_PATH), report.expected)
  io.out(`[env] wrote ${DOCS_PATH}\n`)
  return 0
}
