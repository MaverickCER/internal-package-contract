/**
 * `DocsLinks`: no local link in the docs is broken, and every external one was reachable or is
 * accepted.
 *
 * Reads: the relative-link graph from `README.md`, in Markdown mode, and the site under `docs/`, in
 * HTML mode, `docs/api/` included once generated. Those are two linkinator crawls run by
 * `scripts/check-docs-links.mjs`. Each crawl runs only when its start file exists.
 *
 * Fails on a local link linkinator reports broken that does not exist on disk as a file or
 * directory. A bare directory link is fine: git hosts render it. Fails when linkinator could not
 * run or printed no JSON. Passes with neither `README.md` nor `docs/index.html`. An external link
 * that answered HTTP 429 is passed over: a rate limit says nothing about whether the page exists.
 *
 * Exceptions: none for a local link. Each other unreachable external link is a degradation
 * `DocsLinks:<url>`. It warns locally. Under `--strict`, the CI default, it fails unless
 * `.repo-contract/exceptions/environment.json` holds a complete record. The record id is
 * `environment:DocsLinks:<url>`, one per URL.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 *
 * Limit: external links are filtered in this policy, not with linkinator's `--skip`, whose regex
 * handling can empty a whole crawl.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { degraded } from "./environment-exceptions.js"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const docsLinksScript = path.join(packageRoot, "scripts", "check-docs-links.mjs")

interface LinkinatorLink {
  readonly url: string
  readonly status?: number
  readonly state: "OK" | "BROKEN" | "SKIPPED"
  readonly parent?: string
}
interface LinkinatorReport {
  readonly links?: readonly LinkinatorLink[]
}
type ToolResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export const docsLinks: CheckDefinitionConfig = {
  run: ["node", docsLinksScript],
  output: { format: "json" },
  policy: async ({ result }): Promise<PolicyResult> => {
    const hasReadme = existsSync(path.join(process.cwd(), "README.md"))
    const hasDocsSite = existsSync(path.join(process.cwd(), "docs", "index.html"))
    if (!hasReadme && !hasDocsSite) {
      return { outcome: "pass", rationale: "Docs (links): no README.md or docs/index.html." }
    }

    const envelope = parseToolEnvelope<ToolResult<LinkinatorReport>>(
      result,
      "linkinator",
      "Docs (links): linkinator",
    )
    if (!envelope.ok) return envelope.result

    const evidence = envelope.value
    if (!evidence.ok) {
      return {
        outcome: "fail",
        rationale: `Docs (links): linkinator could not be evaluated: ${evidence.error}`,
      }
    }

    const value = evidence.value
    if (!value || !Array.isArray(value.links)) {
      return { outcome: "fail", rationale: "Docs (links): linkinator produced invalid JSON." }
    }

    const links: readonly LinkinatorLink[] = value.links
    const isExternal = (url: string): boolean => /^https?:\/\//i.test(url)
    // linkinator reports a bare directory link (`specs/decisions/`) as a 404
    // even though every git host renders it. Treat any local link that exists
    // on disk (file or dir), after stripping a `#anchor`/`?query`, as fine.
    const existsLocally = (url: string): boolean => {
      // Stryker disable Regex: two of this line's mutants are equivalent, hand-verified (one at a
      // time, every test in docs-links.test.ts still passes unchanged): Stryker's per-line
      // disable can't separate them from a third, genuinely-killable mutant on this same regex
      // literal (dropping the leading `^` anchor from `/^\.?\//`, covered by the "strips only a
      // LEADING './' or '/'" test above), so that one loses its mutation-score credit too:
      //  - dropping the `$` anchor from `/[#?].*$/` is unobservable for any url this check will
      //    ever see. In a url with no embedded newline (every realistic and every currently-tested
      //    url), `.*` already greedy-consumes to the true end of the string, so `$` never adds
      //    a constraint. An embedded newline does make the two diverge, but then BOTH
      //    variants leave a stray "\n" attached to `rel`, which can never match a real on-disk
      //    filename either way. `existsLocally` can't tell them apart from either side.
      //  - `path.join` (below) already normalizes away a leading "/" whether or not `/^\.?\//`
      //    actually stripped it (`path.join(cwd, "/x")` === `path.join(cwd, "x")`), so relaxing
      //    the optional-dot requirement in `/^\.?\//` to mandatory (`/^\.\//`) can never change
      //    what `existsSync` resolves.
      const rel = decodeURIComponent(url.replace(/[#?].*$/, "")).replace(/^\.?\//, "")
      // Stryker restore Regex
      return rel.length > 0 && existsSync(path.join(process.cwd(), rel))
    }
    const broken = links.filter((l) => l.state === "BROKEN" && !existsLocally(l.url))
    const brokenLocal = broken.filter((l) => !isExternal(l.url))
    // Stryker disable next-line MethodExpression: an equivalent mutant -- this line only ever
    // executes inside the `brokenLocal.length === 0` branch below, at which point `broken` is
    // ALREADY entirely external links by construction (`brokenLocal`/`brokenExternal` partition
    // `broken` by `isExternal`, and the local partition being empty means nothing was excluded
    // from the external one), so `broken.filter(isExternal)` and `broken` are content-identical
    // whenever this value is actually read. Hand-verified: forcing this to `broken` (dropping the
    // filter) leaves every test in docs-links.test.ts passing unchanged.
    const brokenExternal = broken.filter((l) => isExternal(l.url))

    if (brokenLocal.length === 0) {
      const base = `Docs (links): 0 broken local link(s) across ${String(links.length)} checked`
      // HTTP 429 is the host saying "slow down", not "this page is gone", so it is accepted outright:
      // a rate limit is the one degradation that needs no record per URL. Anything else linkinator could
      // not reach (a bot wall, a timeout) is still a degradation, accepted per URL by
      // `environment:DocsLinks:<url>`.
      const rateLimited = new Set(brokenExternal.filter((l) => l.status === 429).map((l) => l.url))
      const urls = [...new Set(brokenExternal.map((l) => l.url))].filter((u) => !rateLimited.has(u))
      const limitedNote = `${String(rateLimited.size)} rate limited, HTTP 429`
      if (urls.length === 0) {
        if (rateLimited.size === 0) return { outcome: "pass", rationale: `${base}.` }
        return {
          outcome: "pass",
          rationale: `${base} (${String(rateLimited.size)} external link(s) were rate limited, HTTP 429, which says nothing about whether they exist).`,
        }
      }
      return degraded({
        check: "DocsLinks",
        codes: urls,
        rationale: `${base} (${String(urls.length)} external link(s) unreachable: ${urls.join(", ")}${rateLimited.size > 0 ? `; ${limitedNote}` : ""}).`,
      })
    }

    return {
      outcome: "fail",
      rationale: [
        `Docs (links): ${String(brokenLocal.length)} broken local link(s):`,
        ...brokenLocal.map(
          (l) =>
            `- ${l.url}${l.parent ? ` (from ${l.parent})` : ""}: HTTP ${String(l.status ?? "?")}`,
        ),
      ].join("\n"),
    }
  },
}
