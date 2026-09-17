/**
 * Git repository maintenance: the checks that keep a package's repo publishable
 * and its history clean, independent of the code itself.
 *
 * Blocks on: not a git repo; a tracked path that should be ignored (build output,
 * `node_modules`, coverage, logs, tarballs); an unresolved merge-conflict marker
 * in a tracked file; a `.gitignore` that does not cover the essentials; a
 * `package.json` missing `files` (an unscoped publish ships everything).
 *
 * Warns on: missing `.gitattributes` / `.editorconfig` / `.nvmrc`; `package.json`
 * missing `license` / `repository` / `engines.node` / `type`. Run
 * `internal-package-contract init` to scaffold the missing files.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, packageRoot } from "./shared.js"

interface GitHygieneEvidence {
  readonly isRepo: boolean
  readonly gitignore?: string
  readonly gitattributesPresent: boolean
  readonly editorconfigPresent: boolean
  readonly nvmrcPresent: boolean
  readonly tracked: readonly string[]
  readonly conflictFiles: readonly string[]
  readonly pkg: {
    readonly private: boolean
    readonly hasFiles: boolean
    readonly hasLicense: boolean
    readonly hasRepository: boolean
    readonly hasEnginesNode: boolean
    readonly hasType: boolean
    readonly hasPackageManager: boolean
  }
}

/** Path prefixes / suffixes that must never be committed. */
const MUST_IGNORE_TRACKED = [
  /^node_modules\//,
  /(^|\/)node_modules\//,
  /^dist\//,
  /^build\//,
  /^coverage\//,
  /^reports\//,
  /^\.stryker-tmp\//,
  /\.log$/,
  /\.tgz$/,
]

/** Substrings a `.gitignore` must contain to be considered complete. */
const GITIGNORE_ESSENTIALS = ["node_modules", "dist", "coverage", ".stryker-tmp", "reports"]

const scriptPath = path.join(packageRoot, "scripts", "git-hygiene.mjs")

/** Issues that block a publish outright: something that must never be committed, or a `package.json` gap an unscoped publish would ship as-is. */
function collectBlockingIssues(ev: GitHygieneEvidence): string[] {
  const blocking: string[] = []

  if (ev.gitignore === undefined) {
    blocking.push("no .gitignore -- run `internal-package-contract init`")
  }

  const badTracked = ev.tracked.filter((f) => MUST_IGNORE_TRACKED.some((re) => re.test(f)))
  if (badTracked.length > 0) {
    blocking.push(
      `${String(badTracked.length)} tracked file(s) that must not be committed: ${badTracked
        .slice(0, 10)
        .join(", ")}${badTracked.length > 10 ? " …" : ""}`,
    )
  }

  if (ev.conflictFiles.length > 0) {
    blocking.push(`unresolved merge-conflict marker(s) in: ${ev.conflictFiles.join(", ")}`)
  }

  if (!ev.pkg.private && !ev.pkg.hasFiles) {
    blocking.push('package.json has no "files" array -- an unscoped publish ships the whole tree')
  }

  return blocking
}

/** Non-blocking suggestions: a present-but-incomplete `.gitignore`, missing `package.json` niceties, missing repo scaffolding files. */
function collectWarnings(ev: GitHygieneEvidence): string[] {
  const warnings: string[] = []

  if (ev.gitignore !== undefined) {
    // Stryker disable next-line OptionalChaining: unreachable, not just unobservable -- this line
    // only ever runs inside the `ev.gitignore !== undefined` guard just above, so `ev.gitignore`
    // can never be nullish here; the `?.` exists only to satisfy the field's own optional type.
    const missing = GITIGNORE_ESSENTIALS.filter((e) => !ev.gitignore?.includes(e))
    if (missing.length > 0) warnings.push(`.gitignore does not mention: ${missing.join(", ")}`)
  }

  if (!ev.pkg.hasLicense) warnings.push('package.json has no "license"')
  if (!ev.pkg.private && !ev.pkg.hasRepository) warnings.push('package.json has no "repository"')
  if (!ev.pkg.hasEnginesNode) warnings.push('package.json has no "engines.node"')
  if (!ev.pkg.hasType) warnings.push('package.json has no "type" ("module" or "commonjs")')
  if (!ev.gitattributesPresent) warnings.push("no .gitattributes")
  if (!ev.editorconfigPresent) warnings.push("no .editorconfig")
  if (!ev.nvmrcPresent) warnings.push("no .nvmrc")

  return warnings
}

export const gitHygiene: CheckDefinitionConfig = {
  run: ["node", scriptPath],
  output: { format: "json" },
  policy: ({ result }): PolicyResult => {
    const terminated = abnormalTermination(result, "git-hygiene")
    if (terminated) return { outcome: "fail", rationale: terminated }

    if (
      !result.output?.success ||
      typeof result.output.value !== "object" ||
      result.output.value === null
    ) {
      return {
        outcome: "fail",
        rationale: "Git hygiene: evidence gatherer produced no readable JSON.",
      }
    }
    const ev = result.output.value as GitHygieneEvidence

    if (!ev.isRepo) {
      return { outcome: "fail", rationale: "Git hygiene: not a git repository. Run `git init`." }
    }

    const blocking = collectBlockingIssues(ev)
    const warnings = collectWarnings(ev)

    if (blocking.length > 0) {
      return {
        outcome: "fail",
        rationale: [
          "Git hygiene: blocking issue(s):",
          ...blocking.map((b) => `- ${b}`),
          ...(warnings.length > 0
            ? ["", "Also (non-blocking):", ...warnings.map((w) => `- ${w}`)]
            : []),
        ].join("\n"),
      }
    }

    if (warnings.length > 0) {
      return {
        outcome: "warn",
        rationale: [
          "Git hygiene: no blocking issues; non-blocking suggestions:",
          ...warnings.map((w) => `- ${w}`),
          "",
          "`internal-package-contract init` scaffolds the missing repo files.",
        ].join("\n"),
      }
    }

    return { outcome: "pass", rationale: "Git hygiene: repo is clean and publishable." }
  },
}
