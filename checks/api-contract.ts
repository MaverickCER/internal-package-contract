/**
 * `ApiContract`: the public TypeScript API changed no more than the branch's changesets declare.
 *
 * Reads: `typedoc.json`, whose entry points are the targets (`scripts/api-contract/targets.ts`).
 * Then the fresh `dist/.dts/` the `Build` barrier produced, each target's committed baseline under
 * `.repo-contract/api-contract/`, `package.json`, and the pending `.changeset/*.md`. Extraction,
 * diff and classification live in `scripts/api-contract/check.ts`; this policy only reads its
 * evidence.
 *
 * Fails when the diff requires a higher release level than the changesets declare. Fails when a
 * target's baseline records another version than package.json: the release did not refresh it, and a
 * stale baseline would let later changes pass unjudged. The `version` script runs `update-baseline`
 * so the release pull request carries the refreshed baselines. Fails when the branch itself rewrote a
 * baseline while package.json keeps the base branch's version (scripts/baseline-guard.mjs); without the
 * base branch in the clone that comparison is skipped. Fails when an
 * exported interface with a literal `version` member changed while that literal did not. No setting
 * or record opts out of that rule. Warns when the change could not be classified, so a person must
 * confirm the declared bump. Passes with no `typedoc.json`: the package documents no entry points
 * this way. A target with no baseline gets its first one written and passes; commit it.
 *
 * Exceptions: none. Add a changeset at the required level (`npx changeset add`). After a release,
 * `internal-package-contract update-baseline` regenerates the baselines.
 *
 * Runs in the consumer `contract` job and in both git hooks, after `Build`. IPC's own self-contract
 * leaves it out: this package has no library surface, and `SurfaceContract` guards its CLI.
 *
 * Limit: a behaviour change behind an unchanged type signature is invisible here.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, unparseableRationale } from "./shared.js"
import type {
  ApiContractEvidence,
  ApiContractTargetResult,
  RequiredReleaseLevel,
} from "../scripts/api-contract/evidence-types.js"

/** Absolute path to this feature's check script: resolved from IPC's own installed location, since `run` executes with the consumer's repo as cwd. */
const checkScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "api-contract",
  "check.ts",
)

interface EvaluateApiContractPolicyInput {
  readonly evidence: ApiContractEvidence
}

interface ApiContractDeterminant {
  readonly summary: string
  readonly staleLiteralExplanations: readonly string[]
  readonly impactUnknown: boolean
  readonly currentVersion: string
  readonly minimumVersionLine: string | undefined
  readonly requiredLevel: RequiredReleaseLevel | undefined
  readonly declaredLevel: RequiredReleaseLevel
  readonly changesetsSatisfied: boolean | null
  readonly changesetsLine: string
  readonly breakingChangePaths: readonly string[]
  readonly lowerTierLine: string | undefined
}

/**
 * Renders what the branch's changesets declare vs. what the API diff requires, as one rationale line.
 * @param evidence - the api-contract check's evidence.
 * @returns the rendered "declared X / required Y" line.
 */
function formatChangesetsLine(evidence: ApiContractEvidence): string {
  const { declaredLevel, changesetCount } = evidence.changesets
  const required = evidence.requiredLevel ?? "unknown"
  const scope =
    changesetCount === 1 ? "1 changeset declares" : `${String(changesetCount)} changeset(s) declare`
  return `Release level: ${scope} \`${declaredLevel}\`; the API diff requires \`${required}\`.`
}

/**
 * @param results - Every target's own result.
 * @returns Every target's own summary, prefixed by target name when there's more than one target (a single-target consumer's summary needs no prefix noise).
 */
function formatLowerTierLine(evidence: ApiContractEvidence): string | undefined {
  const total = evidence.targets.reduce((sum, t) => sum + t.lowerTierDiff.length, 0)
  if (total === 0) return undefined
  return `${String(total)} non-public change(s) also detected across ${String(evidence.targets.length)} target(s) (informational only).`
}

/**
 * Reduces the raw api-contract evidence down to the fields the policy below branches on.
 * @param evidence - the api-contract check's evidence to summarize.
 * @returns the determinant fields the policy evaluates.
 */
function getApiContractDeterminant(evidence: ApiContractEvidence): ApiContractDeterminant {
  const allDiff: readonly (ApiContractTargetResult["diff"][number] & {
    readonly target: string
  })[] = evidence.targets.flatMap((t) => t.diff.map((change) => ({ ...change, target: t.target })))

  return {
    summary: evidence.summary,
    staleLiteralExplanations: allDiff
      .filter((change) => change.kind === "schema-version-literal-stale")
      .map((change) => `[${change.target}] ${change.explanation}`),
    impactUnknown: evidence.requiredLevel === undefined,
    currentVersion: evidence.currentVersion,
    minimumVersionLine:
      evidence.minimumRequiredVersion !== undefined
        ? `Minimum required version if released now: ${evidence.minimumRequiredVersion}.`
        : undefined,
    requiredLevel: evidence.requiredLevel,
    declaredLevel: evidence.changesets.declaredLevel,
    changesetsSatisfied: evidence.changesets.satisfied,
    changesetsLine: formatChangesetsLine(evidence),
    breakingChangePaths: allDiff
      .filter((change) => change.compatibility === "breaking")
      .map((change) => `[${change.target}] ${change.path}`),
    lowerTierLine: formatLowerTierLine(evidence),
  }
}

/**
 * The Changeset a contributor must add so the branch declares `level`.
 * @param level - the release level the public-API diff requires (never `"none"` here: a
 *   `"none"` requirement is always satisfied).
 * @returns an imperative sentence telling the contributor how to add the right changeset.
 */
function remediationForLevel(level: RequiredReleaseLevel | undefined): string {
  switch (level) {
    case "major":
      return "Run `npx changeset add` and declare a `major` bump for this change"
    case "minor":
      return "Run `npx changeset add` and declare a `minor` bump for this change"
    case "patch":
      return "Run `npx changeset add` and declare a `patch` bump for this change"
    default:
      return "Run `npx changeset add` and declare the required bump for this change"
  }
}

/**
 * Versioning is Changesets-driven everywhere in this fleet, so this check can and does **gate**.
 * It fails a PR whose changesets declare a smaller bump than the public-API diff requires (a
 * breaking API change with no changeset, or one under-declared as `patch`/`minor`, etc.). It also
 * fails on an internal schema-version literal that changed shape without its own version marker
 * being bumped. It warns (rather than gating) when the contract delta could not be classified
 * deterministically: that case still needs a human to confirm the declared bump. It cannot catch
 * a behavioral breaking change with an unchanged type signature; that remains a human-review
 * concern.
 * @param root0 - the policy input.
 * @param root0.evidence - the api-contract check's evidence to evaluate.
 * @returns the pass/warn/fail outcome and its rationale.
 */
export function evaluateApiContractPolicy({
  evidence,
}: EvaluateApiContractPolicyInput): PolicyResult {
  const determinant = getApiContractDeterminant(evidence)

  if (evidence.editedBaselines.length > 0) {
    return {
      outcome: "fail",
      rationale: [
        `ApiContract: this branch changed ${evidence.editedBaselines.join(", ")} while package.json stays at ${evidence.currentVersion}, the base branch's version.`,
        "A baseline moves only with a release, so editing it here would hide this branch's own API change.",
        "Restore the baseline from the base branch and declare the change with `npx changeset add`.",
      ].join("\n"),
    }
  }

  if (evidence.staleBaselines.length > 0) {
    return {
      outcome: "fail",
      rationale: [
        `ApiContract: package.json is ${evidence.currentVersion}, but these baselines record another version: ${evidence.staleBaselines.join(", ")}.`,
        "The release that set this version did not refresh them, so later API changes would pass unjudged.",
        "Run `npx internal-package-contract update-baseline` and commit the result, and add `internal-package-contract update-baseline` to the `version` script after the build so every release pull request refreshes them.",
      ].join("\n"),
    }
  }

  if (determinant.staleLiteralExplanations.length > 0) {
    return {
      outcome: "fail",
      rationale: [
        `Contract impact: ${determinant.summary}`,
        "",
        "Internal schema-version consistency violation(s):",
        ...determinant.staleLiteralExplanations.map((explanation) => `- ${explanation}`),
        ...(determinant.lowerTierLine ? ["", determinant.lowerTierLine] : []),
      ].join("\n"),
    }
  }

  if (determinant.changesetsSatisfied === false) {
    const breaking = determinant.breakingChangePaths
    return {
      outcome: "fail",
      rationale: [
        `Contract impact: ${determinant.summary}`,
        "",
        determinant.changesetsLine,
        ...(breaking.length > 0
          ? ["", `Breaking public-API change(s): ${breaking.map((p) => `\`${p}\``).join(", ")}.`]
          : []),
        "",
        `The changesets on this branch do not declare a \`${determinant.requiredLevel ?? "?"}\` ` +
          `release. ${remediationForLevel(determinant.requiredLevel)}, so Changesets bumps ` +
          `the version correctly.`,
        ...(determinant.lowerTierLine ? ["", determinant.lowerTierLine] : []),
      ].join("\n"),
    }
  }

  if (determinant.impactUnknown) {
    return {
      outcome: "warn",
      rationale: [
        `Contract impact: ${determinant.summary}`,
        "",
        `The public contract could not be deterministically classified, so no minimum required ` +
          `level can be established. The branch's changesets declare \`${determinant.declaredLevel}\`. ` +
          `Manually confirm that is an appropriate bump for this change.`,
        ...(determinant.lowerTierLine ? ["", determinant.lowerTierLine] : []),
      ].join("\n"),
    }
  }

  return {
    outcome: "pass",
    rationale: [
      `Contract impact: ${determinant.summary}`,
      "",
      ...(determinant.minimumVersionLine ? [determinant.minimumVersionLine] : []),
      determinant.changesetsLine,
      ...(determinant.lowerTierLine ? ["", determinant.lowerTierLine] : []),
    ].join("\n"),
  }
}

// API Extractor is kept entirely internal to scripts/api-contract/. check.ts owns contract
// extraction/diffing/impact/minimum-level derivation and compares the required level against what
// the branch's changesets declare; the policy above only interprets its evidence, never inspects
// TypeScript/API Extractor/source/Git itself.
// A consumer with no typedoc.json documents no public entry points this way: targets.ts has
// nothing to derive a target list from, so there is nothing for this check to compare. Resolved at
// contract-assembly time (contract.ts is evaluated with the consumer repo as cwd), matching
// `resolveConfig`'s own "decide once, bake into `run`" convention: rather than letting check.ts
// throw at run time and surface as an opaque JSON-parse failure.
const hasTypedocConfig = existsSync(path.join(process.cwd(), "typedoc.json"))

export const apiContract: CheckDefinitionConfig = hasTypedocConfig
  ? {
      run: ["tsx", checkScript, "--release-tag=public"],
      output: { format: "json" },
      policy: ({ result }): PolicyResult => {
        const terminated = abnormalTermination(result, "the api-contract check")
        if (terminated) return { outcome: "fail", rationale: terminated }

        if (!result.output?.success) {
          return { outcome: "fail", rationale: unparseableRationale("ApiContract:", result) }
        }

        return evaluateApiContractPolicy({ evidence: result.output.value as ApiContractEvidence })
      },
    }
  : {
      run: ["node", "-e", ""],
      policy: (): PolicyResult => ({
        outcome: "pass",
        rationale:
          "ApiContract: no typedoc.json, so this package documents no public entry points to compare.",
      }),
    }
