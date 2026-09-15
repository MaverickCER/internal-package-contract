// Runs `coderabbit review --agent --uncommitted` and normalizes its result -- ported from
// repo-contract's own `scripts/coderabbitai/review.ts` (pure CLI-invocation and stream-parsing
// logic, no repo-contract-specific dependencies). Promotes what would otherwise be a local-only
// manual review step into a real, always-declared check: its own non-execution (in CI, where
// review is delegated to the CodeRabbit GitHub App instead, or locally when the CLI isn't
// installed) is recorded and surfaced as a warn on every run, never a silent skip.
//
// Prints `{ status: "reviewed", findings: [...] } | { status: "not-applicable" | "unavailable" |
// "error", reason?, message? }` JSON to stdout -- checks/coderabbitai.ts owns interpreting this
// envelope and reconciling a "reviewed" run's findings against the registry.

import { sync as spawnSync } from "cross-spawn"

const SEVERITY_VALUES = new Set(["critical", "major", "minor"])

/** Whether the current git checkout is on a detached HEAD -- `coderabbit review`'s own base-branch comparison needs a real branch to diff from/to. */
function isDetachedHead() {
  const result = spawnSync("git", ["symbolic-ref", "-q", "HEAD"], { encoding: "utf8" })
  return !result.error && result.status !== 0
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hashSummary(summary) {
  // Web Crypto (globally available in Node 20+) rather than node:crypto, to stay a browser-
  // portable-syntax .mjs script like this package's other scanner scripts.
  const encoder = new TextEncoder()
  return crypto.subtle.digest("SHA-256", encoder.encode(summary.trim())).then((buffer) =>
    [...new Uint8Array(buffer)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12),
  )
}

async function deriveId({ file, severity, summary }) {
  return `coderabbit:${file}:${severity}:${await hashSummary(summary)}`
}

async function normalizeFinding(raw) {
  const { fileName, codegenInstructions, severity: severityRaw } = raw
  if (typeof fileName !== "string" || fileName.length === 0) return undefined
  if (typeof codegenInstructions !== "string" || codegenInstructions.length === 0) return undefined

  const severity =
    typeof severityRaw === "string" && SEVERITY_VALUES.has(severityRaw.toLowerCase())
      ? severityRaw.toLowerCase()
      : "unknown"

  return {
    id: await deriveId({ file: fileName, severity, summary: codegenInstructions }),
    file: fileName,
    severity,
    summary: codegenInstructions,
  }
}

/** Parses `coderabbit review --agent`'s newline-delimited JSON event stream. Fails closed on anything that doesn't match the minimum recognized shape. */
async function parseAgentStream(stdout) {
  const findings = []
  let completed = false

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  for (const line of lines) {
    if (completed) {
      return {
        ok: false,
        error: `coderabbit review --agent produced an event after its terminal "complete" event: ${line}`,
      }
    }

    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      return { ok: false, error: `coderabbit review --agent produced a non-JSON line: ${line}` }
    }

    if (!isPlainObject(parsed) || typeof parsed.type !== "string") {
      return {
        ok: false,
        error: 'coderabbit review --agent produced an event with no recognized "type" field.',
      }
    }

    if (parsed.type === "finding") {
      const finding = await normalizeFinding(parsed)
      if (finding === undefined) {
        return {
          ok: false,
          error:
            'coderabbit review --agent produced a "finding" event missing a required field (fileName/codegenInstructions).',
        }
      }
      findings.push(finding)
      continue
    }

    if (parsed.type === "complete") {
      if (parsed.status !== "review_completed" && parsed.status !== "review_skipped") {
        return {
          ok: false,
          error: `coderabbit review --agent produced a "complete" event with an unexpected status (${JSON.stringify(parsed.status)}); expected "review_completed" or "review_skipped".`,
        }
      }
      if (
        typeof parsed.findings !== "number" ||
        !Number.isInteger(parsed.findings) ||
        parsed.findings < 0 ||
        parsed.findings !== findings.length
      ) {
        return {
          ok: false,
          error: `coderabbit review --agent produced a "complete" event whose findings count (${JSON.stringify(parsed.findings)}) does not match the ${String(findings.length)} finding event(s) actually streamed.`,
        }
      }
      if (parsed.status === "review_skipped" && findings.length > 0) {
        return {
          ok: false,
          error: `coderabbit review --agent produced a "review_skipped" complete event alongside ${String(findings.length)} finding event(s) -- a skipped review cannot also have findings.`,
        }
      }
      completed = true
      continue
    }
    // "review_context"/"status"/"heartbeat"/anything else this wrapper doesn't need: ignored,
    // not rejected -- the stream protocol is inherently extensible.
  }

  return { ok: true, findings, completed }
}

async function runCoderabbitCli() {
  if (process.env.CI) {
    return { status: "not-applicable", reason: "ci", expectedProvider: "coderabbit-github-app" }
  }
  if (isDetachedHead()) {
    return { status: "unavailable", reason: "git-context-unavailable" }
  }

  const result = spawnSync("coderabbit", ["review", "--agent", "--uncommitted"], {
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
    killSignal: "SIGKILL",
    maxBuffer: 32 * 1024 * 1024,
  })

  if (result.error) {
    const nodeError = result.error
    if (nodeError.code === "ENOENT") return { status: "unavailable", reason: "cli-not-installed" }
    if (nodeError.code === "ETIMEDOUT") {
      return { status: "error", message: "The `coderabbit` CLI timed out (exceeded 10 minutes)." }
    }
    if (nodeError.code === "ENOBUFS") {
      return {
        status: "error",
        message: "The `coderabbit` CLI produced more output than its buffer limit.",
      }
    }
    return {
      status: "error",
      message: `Failed to spawn the \`coderabbit\` CLI: ${nodeError.message}`,
    }
  }

  const parsed = await parseAgentStream(result.stdout)
  if (!parsed.ok) return { status: "error", message: parsed.error }

  if (!parsed.completed) {
    const stderrDetail = result.stderr.trim()
    return {
      status: "error",
      message:
        stderrDetail.length > 0
          ? `coderabbit review --agent ended without a "complete" event (exit code ${String(result.status)}): ${stderrDetail}`
          : `coderabbit review --agent ended without a "complete" event (exit code ${String(result.status)}).`,
    }
  }

  // CodeRabbit occasionally streams a byte-identical finding twice; those collapse to one id.
  const seen = new Set()
  const findings = parsed.findings.filter((finding) => {
    if (seen.has(finding.id)) return false
    seen.add(finding.id)
    return true
  })

  return { status: "reviewed", findings }
}

const evidence = await runCoderabbitCli()
process.stdout.write(JSON.stringify(evidence))
process.exitCode = 0
