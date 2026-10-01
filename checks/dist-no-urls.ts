/**
 * No URL may ship in the build output unexplained: Socket.dev flags every `scheme://` string as a
 * "URL strings" supply-chain alert, so the safe default is none at all. This runs repo-contract's
 * `distNoUrls` scanner (every file under the build directory -- code, declarations, sourcemaps)
 * and judges what it finds with the SAME reviewed-exception mechanism every other governed check
 * here uses:
 *
 * - every distinct URL needs a finding-specific record in `.repo-contract/exceptions/dist-urls.json`
 *   with a non-empty `justification`, `alternatives`, `remediation`, `method` and `exceptionType`;
 * - a URL with no record gets a blank stub scaffolded for you to fill in (the check fails until you do);
 * - a record whose URL is no longer shipped is stale and fails until deleted.
 *
 * Nothing is forbidden outright -- a bundled third-party string you cannot change may be accepted
 * with an honest written reason -- but nothing ships unexplained, and each exception is a
 * reviewable diff. Example record (id is `dist-url:<url>`):
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "dist-url:https://example.test/spec",
 *       "version": 1,
 *       "justification": "Part of a bundled dependency's error message; not authored here.",
 *       "alternatives": "Stop bundling that dependency.",
 *       "remediation": "Revisit when the dependency is replaced.",
 *       "method": "independent-human-review",
 *       "exceptionType": "accepted-risk",
 *       "url": "https://example.test/spec"
 *     }
 *   ]
 * }
 * ```
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type {
  ExceptionPolicy,
  ExceptionPolicyConfig,
  ExceptionRecordCore,
  StandardSchemaV1,
} from "repo-contract/helpers"
import { distNoUrls } from "repo-contract/presets"
import {
  EXCEPTION_TYPES,
  SECURITY_EXCEPTION_FIELD_KEYS,
  evaluateFindingVerdict,
  isValidNonEmptyStringField,
  loadAndReconcileExceptionRegistry,
  validateExceptionRegistry,
  validateSecurityExceptionFields,
} from "./exception-record.js"
import type {
  ExceptionMethod,
  ExceptionRegistrySchema,
  ExceptionType,
  PersistedExceptionRegistry,
} from "./exception-record.js"
import { abnormalTermination } from "./shared.js"

const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/dist-urls.json"
const MAX_LISTED = 20

/** One shipped URL, with where it was first seen. */
interface ShippedUrl {
  readonly id: string
  readonly url: string
  readonly where: string
}

/** One `.repo-contract/exceptions/dist-urls.json` record. */
interface DistUrlRecord {
  readonly id: string
  readonly version: 1
  readonly justification: string
  readonly alternatives: string
  readonly remediation: string
  readonly method: "" | ExceptionMethod
  readonly exceptionType: "" | ExceptionType
  readonly url: string
}

interface ScanFinding {
  readonly file: string
  readonly line: number
  readonly url: string
}
interface ScanReport {
  readonly dirExists: boolean
  readonly filesScanned: number
  readonly findings: readonly ScanFinding[]
}

const REQUIREMENTS = ["justification", "alternatives", "remediation", "method", "exceptionType"]

/** Every shipped URL needs a complete record; none is forbidden outright. */
const DIST_URL_POLICY: ExceptionPolicyConfig = {
  "dist-url": { default: { mode: "exception", requirements: [...REQUIREMENTS] } },
}
const DIST_URL_GLOBAL_DEFAULT: ExceptionPolicy = {
  mode: "exception",
  requirements: [...REQUIREMENTS],
}

/** `dist-url:<url>` -- stable while the URL is unchanged. */
export function deriveDistUrlId(url: string): string {
  return `dist-url:${url}`
}

/** A blank record for a URL with none yet -- valid registry data, only policy-insufficient. */
export function createDistUrlStub(shipped: ShippedUrl, id: string): DistUrlRecord {
  return {
    id,
    version: 1,
    justification: "",
    alternatives: "",
    remediation: "",
    method: "",
    exceptionType: "",
    url: shipped.url,
  }
}

/** @internal Exported for direct unit coverage. */
export const DIST_URL_SCHEMA: ExceptionRegistrySchema<DistUrlRecord> = {
  namespace: "dist-url:",
  metadataKeys: [...SECURITY_EXCEPTION_FIELD_KEYS, "url"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const security = validateSecurityExceptionFields(raw, index, EXCEPTION_TYPES, errors)
    const url = raw["url"]
    const urlValid = isValidNonEmptyStringField(url, `${at}.url`, errors)
    if (security === undefined || !urlValid) return undefined

    const derived = deriveDistUrlId(url)
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own url (${JSON.stringify(derived)}).`,
      )
      return undefined
    }
    return { id: core.id, version: 1, justification: core.justification, ...security, url }
  },
}

const registrySchema: StandardSchemaV1<unknown, readonly DistUrlRecord[]> = {
  "~standard": {
    version: 1,
    vendor: "internal-package-contract",
    validate: (value: unknown) => {
      const result = validateExceptionRegistry(value, DIST_URL_SCHEMA)
      return result.ok
        ? { value: result.records }
        : { issues: result.errors.map((message) => ({ message })) }
    },
  },
}

function isScanReport(value: unknown): value is ScanReport {
  if (typeof value !== "object" || value === null) return false
  const report = value as Partial<ScanReport>
  return (
    typeof report.dirExists === "boolean" &&
    typeof report.filesScanned === "number" &&
    Array.isArray(report.findings)
  )
}

/**
 * Collapses raw scan findings to one entry per distinct URL, remembering the first place seen.
 * @internal Exported for direct unit coverage.
 */
export function distinctUrls(findings: readonly ScanFinding[]): readonly ShippedUrl[] {
  const seen = new Map<string, ShippedUrl>()
  for (const finding of findings) {
    if (!seen.has(finding.url)) {
      seen.set(finding.url, {
        id: deriveDistUrlId(finding.url),
        url: finding.url,
        where: `${finding.file}:${String(finding.line)}`,
      })
    }
  }
  return [...seen.values()]
}

/**
 * The final pass/fail composition once every URL has a reconciled record to evaluate against.
 * @internal Exported for direct unit coverage.
 */
export function evaluateDistUrls(
  urls: readonly ShippedUrl[],
  registry: PersistedExceptionRegistry<DistUrlRecord>,
  dir: string,
  filesScanned: number,
): PolicyResult {
  const activeById = new Map(registry.activeRecords.map((record) => [record.id, record]))
  const offenders = urls
    .map((shipped) => ({
      shipped,
      ...evaluateFindingVerdict(
        activeById.get(shipped.id),
        [{ group: "dist-url", category: "url" }],
        DIST_URL_POLICY,
        DIST_URL_GLOBAL_DEFAULT,
      ),
    }))
    .filter((determinant) => determinant.verdict !== "permitted")
  const staleLines = registry.staleRecords.map(
    (record) =>
      `- Stale exception in ${REGISTRY_RELATIVE_PATH}: ${JSON.stringify(record.id)} -- this URL no longer ships; delete this entry.`,
  )

  if (offenders.length === 0 && staleLines.length === 0) {
    const suffix =
      registry.newStubIds.length > 0
        ? ` (${String(registry.newStubIds.length)} new record(s) scaffolded blank in ${REGISTRY_RELATIVE_PATH})`
        : ""
    return {
      outcome: "pass",
      rationale:
        urls.length === 0
          ? `No URLs in ${String(filesScanned)} file(s) under "${dir}".${suffix}`
          : `${String(urls.length)} distinct URL(s) under "${dir}": all explained by a complete exception record.${suffix}`,
    }
  }

  const offenderLines = offenders
    .slice(0, MAX_LISTED)
    .map(
      (d) =>
        `- ${d.shipped.url} (first at ${d.shipped.where}): ${
          d.verdict === "unmatched"
            ? "no reconciled exception record (registry integrity failure)"
            : `exception incomplete (missing: ${d.missing.join(", ")})`
        }`,
    )
  const more =
    offenders.length > MAX_LISTED ? [`- ...and ${String(offenders.length - MAX_LISTED)} more`] : []
  return {
    outcome: "fail",
    rationale: [
      `${String(offenders.length + registry.staleRecords.length)} shipped URL(s) or stale record(s) need attention -- Socket.dev flags every URL in a published package; remove it from the source (comments, JSDoc, string literals, sourcemap content) or explain it in ${REGISTRY_RELATIVE_PATH}:`,
      ...offenderLines,
      ...more,
      ...staleLines,
    ].join("\n"),
  }
}

/** @returns the `DistNoUrls` check for `dir` (default `dist`). */
export function distNoUrlsCheck(dir = "dist"): CheckDefinitionConfig {
  const scanner = distNoUrls({ dir })
  return {
    run: scanner.run,
    // The scanner prints one JSON report to stdout.
    output: { format: "json" },
    policy: async ({ result }): Promise<PolicyResult> => {
      const terminated = abnormalTermination(result, "the dist URL scan")
      if (terminated) return { outcome: "fail", rationale: terminated }

      const value: unknown = result.output?.success ? result.output.value : undefined
      if (!isScanReport(value)) {
        return { outcome: "fail", rationale: "The dist URL scan output could not be parsed." }
      }
      if (!value.dirExists) {
        return {
          outcome: "fail",
          rationale: `Build output directory "${dir}" does not exist -- build before running this check.`,
        }
      }

      const urls = distinctUrls(value.findings)
      const persisted = await loadAndReconcileExceptionRegistry(
        path.join(process.cwd(), REGISTRY_RELATIVE_PATH),
        REGISTRY_RELATIVE_PATH,
        registrySchema,
        urls,
        createDistUrlStub,
      )
      if (!persisted.ok) return { outcome: "fail", rationale: persisted.rationale }

      return evaluateDistUrls(urls, persisted.registry, dir, value.filesScanned)
    },
  }
}
