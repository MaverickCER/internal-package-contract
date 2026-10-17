// `--changed`: run only the checks the changed files can affect.
//
// A change to documentation cannot make TypeScript fail, and a change to a workflow cannot make a link
// broken, so running everything for either is time spent for no information. The rule is deliberately blunt and
// errs toward running more: any file that is not plainly documentation or a workflow runs every check. The
// checks that look at the repository itself (its hooks, pins, managed files, adoption state) always run.

import { spawnSync } from "node:child_process"

/** Checks about the repository's own state, which any change can affect. */
export const ALWAYS = [
  "AdoptionMode",
  "GitHygiene",
  "CleanCheckout",
  "GitHooks",
  "PinConsistency",
  "ManagedFiles",
  "GeneratedRegions",
  "PromptBlocks",
  "Commits",
  "BranchProtection",
]
/** What a change to documentation (Markdown, `docs/`, the changesets, the licence) can affect. */
export const DOCUMENTATION = [
  "Format",
  "DocsMarkdown",
  "DocsLinks",
  "DocsFragments",
  "ReadmeStructure",
  "LandingPage",
  "Accessibility",
  "BenchmarkGuides",
  "ReadmeExample",
]
/** What a change to a workflow or other GitHub configuration can affect. */
export const WORKFLOWS = [
  "Format",
  "GithubActions",
  "EngineMatrix",
  "ScorecardWorkflow",
  "PackedConsumer",
]

const isDocumentation = (file) =>
  /\.(md|txt)$/i.test(file) ||
  file.startsWith("docs/") ||
  file.startsWith(".changeset/") ||
  /^LICENSE(\..*)?$/.test(file) ||
  file === "CODEOWNERS"
const isWorkflow = (file) => file.startsWith(".github/")

/**
 * @param {readonly string[]} files - the changed files, relative to the repository root.
 * @param {readonly string[]} available - every check id the contract declares.
 * @returns {{ ids: string[] | undefined, reason: string }} the checks to run (`undefined`: all of them) and why.
 */
export function selectChanged(files, available) {
  const keep = (ids) => available.filter((id) => ids.includes(id))
  if (files.length === 0) {
    return { ids: keep(ALWAYS), reason: "nothing has changed" }
  }
  const other = files.filter((file) => !isDocumentation(file) && !isWorkflow(file))
  if (other.length > 0) {
    return { ids: undefined, reason: `${other[0]} changed, which can affect any check` }
  }
  const ids = new Set(ALWAYS)
  if (files.some(isDocumentation)) for (const id of DOCUMENTATION) ids.add(id)
  if (files.some(isWorkflow)) for (const id of WORKFLOWS) ids.add(id)
  return {
    ids: keep([...ids]),
    reason: `only ${[files.some(isDocumentation) ? "documentation" : "", files.some(isWorkflow) ? "workflows" : ""].filter(Boolean).join(" and ")} changed`,
  }
}

/**
 * @param {string} cwd - where git runs.
 * @returns {(args: string[]) => string | undefined} runs git there, returning what it printed, or `undefined` when it failed.
 */
export function gitIn(cwd) {
  return (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" })
    return result.status === 0 ? result.stdout : undefined
  }
}

/**
 * @param {string} cwd
 * @param {(args: string[]) => string | undefined} [git] - runs git in `cwd`, returning stdout or undefined on failure; a test seam.
 * @returns {string[] | undefined} what differs from the branch this one came from, plus uncommitted and new files; undefined when git cannot say.
 */
export function changedFiles(cwd, git = gitIn(cwd)) {
  if (git(["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") return undefined
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])?.trim()
  const base = [upstream, "origin/main", "origin/master"].find(
    (name) =>
      name !== undefined &&
      name !== "" &&
      git(["rev-parse", "--verify", "--quiet", name]) !== undefined,
  )
  const lines = [
    ...(base === undefined
      ? []
      : (git(["diff", "--name-only", `${base}...HEAD`]) ?? "").split("\n")),
    ...(git(["diff", "--name-only", "HEAD"]) ?? "").split("\n"),
    ...(git(["ls-files", "--others", "--exclude-standard"]) ?? "").split("\n"),
  ]
  return [...new Set(lines.map((line) => line.trim()).filter(Boolean))]
}
