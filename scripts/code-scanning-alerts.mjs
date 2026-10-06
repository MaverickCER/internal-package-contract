// Entry point for the `CodeScanning` check (see checks/code-scanning.ts).
//
// Reads this repository's OPEN GitHub code-scanning alerts with the developer's own `gh` login and
// prints ONE JSON envelope to stdout: `{ ok: true, data: { alerts } | { skipped } }`, or
// `{ ok: false, message, data: { kind } }` when the alerts could not be read. Locally it reads with the
// developer's own `gh` login and the checked-out branch; in CI it reads with the workflow's token
// (`permissions: security-events: read`, `GH_TOKEN: ${{ github.token }}`), for the repository named by
// GITHUB_REPOSITORY and the ref being built (GITHUB_REF, which for a pull request is its merge ref).
// It never exits non-zero for a GitHub-side problem -- the policy decides.

import { sync as spawnSync } from "cross-spawn"
import path from "node:path"
import { resolveOwnerRepo } from "./github-repo.mjs"

const PAGE_SIZE = 100
// A safety valve against a runaway loop, not a limit on the result: reaching it is reported as a
// failure (`kind: "truncated"`) rather than judging a silently cut-off set of alerts.
const MAX_PAGES = Number(process.env["CODE_SCANNING_MAX_PAGES"]) || 1000

function emit(envelope) {
  process.stdout.write(JSON.stringify(envelope))
}

function isCi(env) {
  const ci = env["CI"]
  return (Boolean(ci) && ci !== "false" && ci !== "0") || env["GITHUB_ACTIONS"] === "true"
}

/** One alert, reduced to what the policy needs. */
function flatten(alert) {
  const location = alert.most_recent_instance?.location ?? {}
  return {
    number: alert.number,
    rule: alert.rule?.id ?? "unknown-rule",
    severity: alert.rule?.security_severity_level ?? alert.rule?.severity ?? "unknown",
    path: location.path ?? "",
    line: location.start_line ?? 0,
    tool: alert.tool?.name ?? "unknown",
    message: String(alert.most_recent_instance?.message?.text ?? "").slice(0, 300),
  }
}

/** The branch checked out in `cwd`, or undefined for a detached HEAD or a directory that is not a repository. */
function currentBranch(cwd) {
  const result = spawnSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd, encoding: "utf8" })
  const name = result.status === 0 ? result.stdout.trim() : ""
  return name === "" ? undefined : name
}

function readPage(owner, repo, page, ref) {
  // Alerts are scoped to the ref being worked on, so a branch carrying a fix is judged on its own
  // analysis rather than on the default branch's still-open alert; with no analysis yet there are none.
  const refParam = ref === undefined ? "" : `&ref=${encodeURIComponent(ref)}`
  const result = spawnSync(
    "gh",
    [
      "api",
      `repos/${owner}/${repo}/code-scanning/alerts?state=open&per_page=${PAGE_SIZE}&page=${page}${refParam}`,
    ],
    { encoding: "utf8" },
  )
  if (result.error) {
    return { failure: { kind: "gh-not-installed", message: result.error.message } }
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return {
      failure: { kind: "unreadable", message: (result.stderr || result.stdout).slice(0, 300) },
    }
  }
  if (Array.isArray(parsed)) return { alerts: parsed }
  const message = String(parsed?.message ?? "")
  if (/no analysis found/i.test(message)) return { alerts: [] }
  if (/advanced security must be enabled|code scanning is not enabled/i.test(message)) {
    return { disabled: true }
  }
  if (
    String(parsed?.status) === "401" ||
    /requires authentication|bad credentials/i.test(message)
  ) {
    return { failure: { kind: "not-authenticated", message } }
  }
  if (String(parsed?.status) === "403" || String(parsed?.status) === "404") {
    return { failure: { kind: "no-access", message } }
  }
  return { failure: { kind: "unreadable", message: message || result.stderr.slice(0, 300) } }
}

function hasToken(env) {
  return Boolean(env["GH_TOKEN"] || env["GITHUB_TOKEN"])
}

/** The repository and ref to read alerts for: CI's own (`GITHUB_REPOSITORY`, `GITHUB_REF`), else the local checkout's. */
function resolveTarget(env) {
  if (isCi(env) && env["GITHUB_REPOSITORY"]) {
    const [owner, repo] = env["GITHUB_REPOSITORY"].split("/")
    if (owner && repo) return { owner, repo, ref: env["GITHUB_REF"] || undefined }
  }
  const target = resolveOwnerRepo(process.cwd())
  if (target === undefined) return undefined
  const branch = currentBranch(process.cwd())
  return { ...target, ref: branch === undefined ? undefined : `refs/heads/${branch}` }
}

function main() {
  if (isCi(process.env) && !hasToken(process.env)) {
    return emit({
      ok: false,
      message:
        "no GH_TOKEN in CI -- add `permissions: security-events: read` and `GH_TOKEN: ${{ github.token }}` to the contract job",
      data: { kind: "no-token" },
    })
  }
  const target = resolveTarget(process.env)
  if (target === undefined) {
    return emit({
      ok: true,
      data: { skipped: `no GitHub remote found for ${path.basename(process.cwd())}` },
    })
  }
  const alerts = []
  let outcome
  let exhausted = false
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = readPage(target.owner, target.repo, page, target.ref)
    if (result.failure !== undefined || result.disabled === true) {
      outcome = result
      break
    }
    alerts.push(...result.alerts.map(flatten))
    if (result.alerts.length < PAGE_SIZE) {
      exhausted = true
      break
    }
  }
  if (outcome?.failure !== undefined) {
    emit({ ok: false, message: outcome.failure.message, data: { kind: outcome.failure.kind } })
  } else if (outcome?.disabled === true) {
    emit({ ok: true, data: { skipped: "code scanning is not enabled for this repository" } })
  } else if (!exhausted) {
    emit({
      ok: false,
      message: `more than ${String(MAX_PAGES * PAGE_SIZE)} open alerts -- refusing to judge a truncated list`,
      data: { kind: "truncated" },
    })
  } else {
    emit({ ok: true, data: { repo: `${target.owner}/${target.repo}`, alerts } })
  }
}

main()
