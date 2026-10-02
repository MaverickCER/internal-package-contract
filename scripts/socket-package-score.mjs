// Entry point for the `SecuritySocket` check (see checks/security-socket.ts).
//
// Why `socket package score` and not `socket ci`: `socket ci` scans the repo's manifests against the
// org security policy and by default reports ONLY "error"-level alerts -- confirmed against a real
// data-cap run: `socket ci` reported `healthy: true, alerts: {}` while the package page showed
// `urlStrings`, `minifiedFile`, `shellAccess` (cross-spawn), `gptDidYouMean` (hashery) and
// `usesEval` (ajv). `socket package score` returns exactly what the package's own Socket page
// shows, for the package itself and its whole transitive closure (peer dependencies included).
//
// Scores the current `package.json` version; if Socket has no result for it (not published yet, or
// not indexed yet) it scores the latest published version instead and says so. A private or
// unnamed package ships nothing, so there is nothing to score.
//
// Prints ONE JSON envelope to stdout, in Socket's own `{ ok, message, cause, data }` shape for
// failures (passed through verbatim so the policy can classify them) and
// `{ ok: true, data: { skipped | unpublished | purl, scoredVersion, requestedVersion, alerts } }`
// otherwise. Never exits non-zero for a Socket-side problem -- the policy decides.

import { sync as spawnSync } from "cross-spawn"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const SOCKET_FLAGS = ["--json", "--no-banner", "--no-spinner"]

function emit(envelope) {
  process.stdout.write(JSON.stringify(envelope))
}

function runJson(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.error)
    return { spawnError: result.error.code ?? "UNKNOWN", message: result.error.message }
  try {
    return { parsed: JSON.parse(result.stdout.trim()) }
  } catch {
    return { raw: result.stdout, stderr: result.stderr }
  }
}

const RATE_LIMIT_RETRIES = 3
const RATE_LIMIT_WAIT_MS = Number(process.env.SOCKET_SCORE_RETRY_WAIT_MS ?? 10_000)

/** Scores one version, waiting out Socket's HTTP 429 a few times before giving up. */
function score(name, version) {
  let attempt = { parsed: undefined }
  for (let tries = 0; tries <= RATE_LIMIT_RETRIES; tries += 1) {
    attempt = runJson("socket", ["package", "score", "npm", `${name}@${version}`, ...SOCKET_FLAGS])
    if (attempt.parsed?.data?.code !== 429) return attempt
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RATE_LIMIT_WAIT_MS)
  }
  return attempt
}

function flatten(data) {
  const scoped = (scope, section) =>
    (section?.alerts ?? []).map((alert) => ({
      name: alert.name,
      severity: alert.severity,
      category: alert.category,
      example: alert.example,
      scope,
    }))
  return [...scoped("self", data.self), ...scoped("transitive", data.transitively)]
}

const pkgFile = path.join(process.cwd(), "package.json")
if (!existsSync(pkgFile)) {
  emit({ ok: true, data: { skipped: "no package.json in the working directory" } })
} else {
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"))
  if (pkg.private === true || typeof pkg.name !== "string" || typeof pkg.version !== "string") {
    emit({ ok: true, data: { skipped: "package is private or unnamed, so nothing is published" } })
  } else {
    let scoredVersion = pkg.version
    let attempt = score(pkg.name, scoredVersion)
    const notFound = (a) => a.parsed?.ok === false && a.parsed?.data?.code === 404
    if (notFound(attempt)) {
      const latest = runJson("npm", ["view", pkg.name, "version", "--json"])
      const published = typeof latest.parsed === "string" ? latest.parsed : undefined
      if (published === undefined) {
        emit({ ok: true, data: { unpublished: true, requestedVersion: pkg.version } })
        process.exit(0)
      }
      scoredVersion = published
      attempt = score(pkg.name, scoredVersion)
    }

    if (attempt.spawnError !== undefined) {
      emit({
        ok: false,
        message: "Spawn Error",
        cause: attempt.spawnError,
        data: { code: attempt.spawnError },
      })
    } else if (attempt.parsed === undefined) {
      emit({
        ok: false,
        message: "Unparseable Output",
        cause: (attempt.stderr || attempt.raw || "").slice(0, 500),
      })
    } else if (attempt.parsed.ok !== true) {
      emit(attempt.parsed)
    } else {
      emit({
        ok: true,
        data: {
          package: pkg.name,
          purl: attempt.parsed.data?.purl,
          requestedVersion: pkg.version,
          scoredVersion,
          alerts: flatten(attempt.parsed.data ?? {}),
        },
      })
    }
  }
}
