/**
 * Broken-link detection for the docs reachable from `README.md`, via linkinator.
 *
 * Differences from the `brokenLinks` preset, all forced by linkinator quirks:
 *   - starts at `README.md` and `--recurse`s the relative-link graph -- its
 *     directory-recurse mode only follows `index.html`, never loose `.md` files;
 *   - `--markdown` -- linkinator silently stops parsing markdown when `--format
 *     json` is set unless this is explicit;
 *   - external (`http(s)://`) links are filtered in the policy, not via
 *     linkinator's `--skip` (whose regex handling zeroes the whole crawl for
 *     several common patterns). External link rot is best-effort, not a release
 *     gate; a broken *local* link is always blocking.
 *   - a local link that resolves to an existing file OR directory on disk is
 *     not counted broken -- linkinator 404s a bare directory link (`specs/`)
 *     that a git host (GitHub, GitLab) renders fine.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput, firstExisting } from "./shared.js"

interface LinkinatorLink {
  readonly url: string
  readonly status?: number
  readonly state: "OK" | "BROKEN" | "SKIPPED"
  readonly parent?: string
}
interface LinkinatorReport {
  readonly links?: readonly LinkinatorLink[]
}

export const docsLinks: CheckDefinitionConfig = {
  run: ["linkinator", "README.md", "--recurse", "--markdown", "--format", "json"],
  output: { format: "json" },
  policy: ({ result }): PolicyResult => {
    if (!firstExisting(["README.md"])) {
      return { outcome: "pass", rationale: "Docs (links): no README.md." }
    }

    const terminated = abnormalTermination(result, "linkinator")
    if (terminated) return { outcome: "fail", rationale: terminated }

    if (!result.output?.success) {
      const printed = combinedOutput(result)
      return {
        outcome: "fail",
        rationale: `Docs (links): linkinator output could not be parsed as JSON.${printed ? `\n${printed}` : ""}`,
      }
    }

    const value = result.output.value as LinkinatorReport | null
    if (!value || !Array.isArray(value.links)) {
      return { outcome: "fail", rationale: "Docs (links): linkinator produced invalid JSON." }
    }

    const links: readonly LinkinatorLink[] = value.links
    const isExternal = (url: string): boolean => /^https?:\/\//i.test(url)
    // linkinator reports a bare directory link (`specs/decisions/`) as a 404
    // even though every git host renders it. Treat any local link that exists
    // on disk (file or dir) -- stripping a `#anchor`/`?query` -- as fine.
    const existsLocally = (url: string): boolean => {
      const rel = decodeURIComponent(url.replace(/[#?].*$/, "")).replace(/^\.?\//, "")
      return rel.length > 0 && existsSync(path.join(process.cwd(), rel))
    }
    const broken = links.filter((l) => l.state === "BROKEN" && !existsLocally(l.url))
    const brokenLocal = broken.filter((l) => !isExternal(l.url))
    const brokenExternal = broken.filter((l) => isExternal(l.url))

    if (brokenLocal.length === 0) {
      const note =
        brokenExternal.length > 0
          ? ` (${String(brokenExternal.length)} external link(s) also unreachable -- not blocking)`
          : ""
      return {
        outcome: brokenExternal.length > 0 ? "warn" : "pass",
        rationale: `Docs (links): 0 broken local link(s) across ${String(links.length)} checked${note}.`,
      }
    }

    return {
      outcome: "fail",
      rationale: [
        `Docs (links): ${String(brokenLocal.length)} broken local link(s):`,
        ...brokenLocal.map(
          (l) =>
            `- ${l.url}${l.parent ? ` (from ${l.parent})` : ""} -- HTTP ${String(l.status ?? "?")}`,
        ),
      ].join("\n"),
    }
  },
}
