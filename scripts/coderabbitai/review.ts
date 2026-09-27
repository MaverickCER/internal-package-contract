// Entry point for the `CodeRabbit` check, invoked via `run: ["tsx", <absolute path to this file>]`
// in checks/coderabbitai.ts. Prints ONLY the JSON evidence to stdout (for `output: { format:
// "json" }` to parse) -- the same stdout contract scripts/check-accessibility.mjs already follows.
//
// A generic recreation of repo-contract's own scripts/coderabbitai/review.ts, rebuilt on this
// package's own checks/exception-record.ts plus repo-contract's PUBLISHED `repo-contract/helpers`
// surface; see checks/coderabbitai.ts's own doc comment.
//
// Wrapper tooling, not a published library module: this script may read the ambient environment
// (`process.env.CI`) and spawn a git subprocess for its own pre-flight check, the same latitude
// scripts/git-hygiene.mjs and scripts/github-repo.mjs already take.
//
// Report-only: this script's own exit code is never the pass/fail signal (checks/coderabbitai.ts's
// policy, reading this same evidence, is) -- it always exits 0 once it has produced *some*
// well-formed evidence, including `status: "not-applicable"`/`"unavailable"`/`"error"`.

import { sync as spawnSync } from "cross-spawn"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { loadExceptionRegistry } from "repo-contract/helpers"
import type { StandardSchemaV1 } from "repo-contract/helpers"
import {
  reconcileAndPersistExceptionRegistry,
  validateExceptionRegistry,
} from "../../checks/exception-record.js"
import type {
  CoderabbitEvidence,
  CoderabbitExceptionRecord,
  NormalizedFinding,
} from "./evidence-types.js"
import {
  CODERABBIT_EXCEPTION_SCHEMA,
  createCoderabbitStub,
  deriveCoderabbitExceptionId,
} from "./registry.js"

/** Where a consumer's CodeRabbit exception registry lives -- the standard `.repo-contract/exceptions/*.json` location every repo-contract v0.4.0+ registry shares. */
const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/coderabbit.json"

/** The raw result of running the CodeRabbit CLI, before any registry reconciliation. */
type CoderabbitCliResult =
  | { readonly status: "reviewed"; readonly findings: readonly NormalizedFinding[] }
  | {
      readonly status: "not-applicable"
      readonly reason: "ci"
      readonly expectedProvider: "coderabbit-github-app"
    }
  | {
      readonly status: "unavailable"
      readonly reason: "cli-not-installed" | "git-context-unavailable"
    }
  | { readonly status: "error"; readonly message: string }

const registrySchema: StandardSchemaV1<unknown, readonly CoderabbitExceptionRecord[]> = {
  "~standard": {
    version: 1,
    vendor: "internal-package-contract",
    validate: (value: unknown) => {
      const result = validateExceptionRegistry(value, CODERABBIT_EXCEPTION_SCHEMA)
      return result.ok
        ? { value: result.records }
        : { issues: result.errors.map((message) => ({ message })) }
    },
  },
}

/** The severity values the CLI itself may report -- anything else normalizes to `"unknown"`. */
const SEVERITY_VALUES = new Set(["critical", "major", "minor"])

/**
 * Whether the current git checkout is on a detached `HEAD` -- `coderabbit review`'s own base-
 * branch comparison needs a real branch to diff from/to, and a detached checkout (a CI runner mid-
 * rebase, a tag checkout, a bisect) is a genuine "can't establish git context" condition this
 * wrapper recognizes itself, up front, rather than trying to parse it back out of whatever error
 * text a future CLI version happens to print for the same underlying problem.
 * @returns `true` if `HEAD` is detached (not on a named branch).
 */
function isDetachedHead(): boolean {
  const result = spawnSync("git", ["symbolic-ref", "-q", "HEAD"], { encoding: "utf8" })
  // A real spawn failure (git itself missing) is not this function's concern -- `coderabbit`
  // itself would fail identically and far more informatively; only a *successful* git invocation
  // that reports "no symbolic ref" (a non-zero exit with no spawn error) means detached HEAD.
  return !result.error && result.status !== 0
}

/**
 * Whether `value` is a non-null, non-array object.
 * @param value - The candidate value to check.
 * @returns `true` if `value` is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Normalizes one real `{"type":"finding", ...}` event -- confirmed shape (see evidence-types.ts's
 * own doc comment): `severity`, `fileName`, `codegenInstructions`. Rejects an entry missing
 * `fileName`/`codegenInstructions` outright (the caller treats any rejection as `status: "error"`
 * for the whole stream).
 * @param raw - One candidate finding event, already known to have `type === "finding"`.
 * @returns The normalized finding, or `undefined` if `raw` doesn't match the minimum recognized shape.
 */
function normalizeFinding(raw: Record<string, unknown>): NormalizedFinding | undefined {
  const { fileName, codegenInstructions, severity: severityRaw } = raw
  if (typeof fileName !== "string" || fileName.length === 0) return undefined
  if (typeof codegenInstructions !== "string" || codegenInstructions.length === 0) return undefined

  const severity =
    typeof severityRaw === "string" && SEVERITY_VALUES.has(severityRaw.toLowerCase())
      ? (severityRaw.toLowerCase() as "critical" | "major" | "minor")
      : "unknown"

  return {
    id: deriveCoderabbitExceptionId({ file: fileName, severity, summary: codegenInstructions }),
    file: fileName,
    severity,
    summary: codegenInstructions,
  }
}

/**
 * Parses `coderabbit review --agent`'s newline-delimited JSON event stream. Unrecognized event
 * `type`s are silently skipped -- the stream protocol is inherently extensible (progress/status
 * events already vary run to run) and a future CLI version adding a new informational event type
 * must not break this check. A `finding` event that doesn't match the minimum recognized shape,
 * or a line that isn't parseable JSON at all, is NOT silently skipped -- either fails the whole
 * parse closed, exactly like `checks/mutation.ts` does for a malformed Stryker report.
 * @param stdout - The CLI's raw captured stdout.
 * @returns The findings observed and whether a terminal `complete` event was seen, or the error message if parsing failed closed.
 */
export function parseAgentStream(stdout: string):
  | {
      readonly ok: true
      readonly findings: readonly NormalizedFinding[]
      readonly completed: boolean
    }
  | { readonly ok: false; readonly error: string } {
  const findings: NormalizedFinding[] = []
  let completed = false

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  for (const line of lines) {
    // The `complete` event is terminal by definition -- anything after it means the stream did
    // not end where the CLI said it did (a truncated-and-concatenated capture, a second review's
    // output bleeding in). Accepting a trailing `finding` here would silently add it to an
    // already-"completed" result; fail the whole parse closed instead.
    if (completed) {
      return {
        ok: false,
        error: `coderabbit review --agent produced an event after its terminal "complete" event: ${line}`,
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return { ok: false, error: `coderabbit review --agent produced a non-JSON line: ${line}` }
    }

    if (!isPlainObject(parsed) || typeof parsed["type"] !== "string") {
      return {
        ok: false,
        error: 'coderabbit review --agent produced an event with no recognized "type" field.',
      }
    }

    if (parsed["type"] === "finding") {
      const finding = normalizeFinding(parsed)
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

    if (parsed["type"] === "complete") {
      // Two terminal statuses confirmed by direct observation against a real CLI:
      // `"review_completed"` (a review ran; `findings` count is on this same event), and
      // `"review_skipped"` (there was nothing in scope to review -- an empty diff -- which the
      // CLI emits when `--uncommitted` finds no tracked edits). Both are clean, findings-complete
      // terminal states. Any *other* status (missing, an unsuccessful value) means the review did
      // not actually finish -- accepting it would let an incomplete run produce a clean result.
      if (parsed["status"] !== "review_completed" && parsed["status"] !== "review_skipped") {
        return {
          ok: false,
          error: `coderabbit review --agent produced a "complete" event with an unexpected status (${JSON.stringify(parsed["status"])}); expected "review_completed" or "review_skipped".`,
        }
      }
      // The terminal event carries its own findings *count*. Every individual `finding` event is
      // streamed as its own line before this one, so that count and the number of findings
      // actually parsed must agree exactly. A `complete` claiming more findings than were streamed
      // means the stream was truncated (and accepting it would let an incomplete run produce a
      // clean `reviewed` result); claiming fewer means an event this parser recognized that the
      // CLI itself didn't count. Either way the stream is malformed -- fail closed, exactly as a
      // bad status does.
      if (
        typeof parsed["findings"] !== "number" ||
        !Number.isInteger(parsed["findings"]) ||
        parsed["findings"] < 0 ||
        parsed["findings"] !== findings.length
      ) {
        return {
          ok: false,
          error: `coderabbit review --agent produced a "complete" event whose findings count (${JSON.stringify(parsed["findings"])}) does not match the ${String(findings.length)} finding event(s) actually streamed.`,
        }
      }
      // `review_skipped` means "nothing was in scope to review" -- it must carry zero findings.
      // A `review_skipped` with findings streamed is self-contradictory (the CLI both skipped and
      // reviewed), and treating it as a clean terminal state would let those findings through
      // unevaluated.
      if (parsed["status"] === "review_skipped" && findings.length > 0) {
        return {
          ok: false,
          error: `coderabbit review --agent produced a "review_skipped" complete event alongside ${String(findings.length)} finding event(s) -- a skipped review cannot also have findings.`,
        }
      }
      completed = true
      continue
    }

    // "review_context"/"status"/"heartbeat"/anything else this wrapper doesn't need to interpret
    // -- see this function's own doc comment on why these are ignored, not rejected.
  }

  return { ok: true, findings, completed }
}

/**
 * Runs `coderabbit review --agent` and normalizes its result. Never throws -- every recognized or
 * unrecognized outcome becomes a well-formed `CoderabbitCliResult` value instead.
 * @returns This run's normalized CLI result.
 */
function runCoderabbitCli(): CoderabbitCliResult {
  // In CI the review is delegated to CodeRabbit's own GitHub App, which posts findings directly on
  // the pull request -- this local CLI pass is deliberately the narrower, faster layer, never a
  // duplicate of it (repo-contract ADR 0014).
  if (process.env["CI"]) {
    return { status: "not-applicable", reason: "ci", expectedProvider: "coderabbit-github-app" }
  }

  if (isDetachedHead()) {
    return { status: "unavailable", reason: "git-context-unavailable" }
  }

  const result = spawnSync("coderabbit", ["review", "--agent", "--uncommitted"], {
    encoding: "utf8",
    // A real review of a small local diff completes in ~1-2 min against an observed real run;
    // 10 min is a generous ceiling that still bounds a stalled process so it can never hang
    // `runCoderabbitReview`, the consumer's own `npm run contract`, or the pre-push hook
    // indefinitely. `cross-spawn` forwards this straight to `child_process.spawnSync`.
    timeout: 10 * 60 * 1000,
    // `SIGKILL` (not the default `SIGTERM`): a wedged `coderabbit` process that ignores or slowly
    // handles `SIGTERM` would keep `spawnSync` blocked past the deadline anyway.
    killSignal: "SIGKILL",
    // The `--agent` stream is line-delimited JSON, one short object per finding plus a handful of
    // status lines -- far under the 1 MiB `spawnSync` default, but raised well clear of it so a
    // verbose review can never be misreported as a spawn failure via `ENOBUFS`.
    maxBuffer: 32 * 1024 * 1024,
  })

  if (result.error) {
    const nodeError = result.error as NodeJS.ErrnoException
    if (nodeError.code === "ENOENT") {
      return { status: "unavailable", reason: "cli-not-installed" }
    }
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

  const parsed = parseAgentStream(result.stdout)
  if (!parsed.ok) {
    return { status: "error", message: parsed.error }
  }

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

  return { status: "reviewed", findings: parsed.findings }
}

/**
 * Runs the CodeRabbit CLI, then -- only when a review actually ran (`reviewed`) -- reconciles the
 * consumer's `.repo-contract/exceptions/coderabbit.json` against the findings and writes it back,
 * via this package's own shared `reconcileAndPersistExceptionRegistry`
 * (`checks/exception-record.ts`) -- the one entrypoint `SecuritySocket`/`SecurityDeps` already use
 * for exactly this reconcile -> validate -> persist sequence. On `not-applicable` (CI) /
 * `unavailable` / `error` the registry is validated but not reconciled.
 * @param root - Absolute path to the repository being checked (the consumer's own `process.cwd()`).
 * @returns The full `CoderabbitEvidence` for `output: { format: "json" }`.
 */
export async function runCoderabbitReview(root: string): Promise<CoderabbitEvidence> {
  const cli = runCoderabbitCli()
  const registryPath = path.join(root, REGISTRY_RELATIVE_PATH)
  const loaded = await loadExceptionRegistry({ path: registryPath, schema: registrySchema })

  if (cli.status !== "reviewed") {
    const base =
      cli.status === "not-applicable"
        ? {
            status: cli.status,
            reason: cli.reason,
            expectedProvider: cli.expectedProvider,
            registryPath: REGISTRY_RELATIVE_PATH,
          }
        : cli.status === "unavailable"
          ? { status: cli.status, reason: cli.reason, registryPath: REGISTRY_RELATIVE_PATH }
          : { status: cli.status, message: cli.message, registryPath: REGISTRY_RELATIVE_PATH }
    return loaded.ok
      ? { ...base, existingRecordCount: loaded.records.length }
      : { ...base, existingRecordCount: 0, registryError: loaded.errors }
  }

  // CodeRabbit occasionally streams a byte-identical finding twice; those collapse to one id.
  // Deduping here (not in parseAgentStream) keeps the `complete` event's own findings-count check
  // honest -- it counts raw streamed events.
  const seen = new Set<string>()
  const findings = cli.findings.filter((finding) => {
    if (seen.has(finding.id)) return false
    seen.add(finding.id)
    return true
  })

  const empty = {
    status: "reviewed" as const,
    registryPath: REGISTRY_RELATIVE_PATH,
    findings,
    activeExceptions: {} as Record<string, CoderabbitExceptionRecord>,
    staleExceptions: [] as readonly CoderabbitExceptionRecord[],
    scaffoldedIds: [] as readonly string[],
  }
  if (!loaded.ok) return { ...empty, registryError: loaded.errors }

  const persisted = await reconcileAndPersistExceptionRegistry<
    NormalizedFinding,
    CoderabbitExceptionRecord
  >(registryPath, REGISTRY_RELATIVE_PATH, loaded.records, findings, createCoderabbitStub)
  if (!persisted.ok) return { ...empty, registryError: [persisted.rationale] }

  const { activeRecords, staleRecords, newStubIds } = persisted.registry
  const activeExceptions: Record<string, CoderabbitExceptionRecord> = {}
  for (const record of activeRecords) activeExceptions[record.id] = record

  return {
    status: "reviewed",
    registryPath: REGISTRY_RELATIVE_PATH,
    findings,
    activeExceptions,
    staleExceptions: staleRecords,
    scaffoldedIds: newStubIds,
  }
}

// Only run when invoked directly, never when imported by a test -- unlike this package's other
// wrapper scripts (all plain `.mjs`, executed top-level and exercised only through their spawned
// output), `parseAgentStream`/`runCoderabbitReview` are imported directly by the unit and
// integration suites, so the module body must stay import-safe. Mirrors repo-contract's own
// scripts/coderabbitai/review.ts guard.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runCoderabbitReview(process.cwd())
  process.stdout.write(JSON.stringify(evidence))
}
