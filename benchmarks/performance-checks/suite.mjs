// internal-package-contract benchmark suite: the cost of taking checks apart and putting them back
// together (`checks/parts`), reading a check's evidence envelope (`checks/shared`) and assembling the
// whole standard (`checks/standard`). This is the overhead a consumer's `contract.ts` pays every time
// it is evaluated, which is every contract run and every editor integration. It is development and CI
// cost, never runtime cost. See ../READING-BENCHMARKS.md and ../WRITING-BENCHMARKS.md.

import { register } from "tsx/esm/api"
import { defineSuite } from "../../scripts/benchmark/kit/index.mjs"

register()
const parts = await import("../../checks/parts.ts")
const shared = await import("../../checks/shared.ts")
const standard = await import("../../checks/standard.ts")

const SLOW = { warmupIterations: 1, minIterations: 3, maxIterations: 8, targetDurationMs: 1000 }

const policy = () => Promise.resolve({ outcome: "pass", rationale: "ok" })
const checkOf = (i) => ({
  run: ["node", `scripts/check-${String(i)}.mjs`],
  output: { format: "json" },
  timeoutMs: 1000,
  policy,
})
const checksOf = (n) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`C${String(i)}`, checkOf(i)]))

const CHECKS = {
  name: "checks in the set",
  how: "swept",
  description: "The tier axis: how many checks the set being split or assembled holds.",
}
const SHAPE = {
  name: "check shape",
  how: "fixed",
  value: "a command, a JSON output request, a timeout and a policy",
  description:
    "A check that sets more fields (env, cwd, a schema) copies a few more keys; the cost stays tiny.",
}
const RUNTIME = {
  name: "runtime",
  how: "fixed",
  value: "Node (V8)",
  description: "Measured on Node only.",
}

const one = (id, name, why, run) => ({
  id,
  name,
  why,
  poorPerformanceMeans:
    "Every contract run, every editor integration and every `--help` that evaluates a consumer's contract.ts would start later; the cost is multiplied by the number of checks adapted.",
  expectedComplexity: "constant",
  complexityReason:
    "It copies the handful of fields one check has into a new object, so the work does not depend on how many checks the set holds.",
  variables: [CHECKS, SHAPE, RUNTIME],
  inEndToEnd: { callsPerOperation: (n) => n, description: "Once per check the consumer adapts." },
  sampling: SLOW,
  setup: () => ({ check: checkOf(0) }),
  run,
})

export default defineSuite({
  package: { name: "internal-package-contract" },
  workload: {
    unit: "check",
    description:
      "One check in a check set. The standard holds about fifty, so 80 checks is a consumer that adds a few of its own; the ladder goes far beyond to expose any super-linear behavior.",
    typicalN: 80,
  },
  endToEnd: {
    purpose:
      "Shows what a consumer pays to adapt a check set: take every check apart, replace the evidence of each one and put them back together, compared with copying the objects directly. The baseline is the unavoidable floor, so the difference is the cost of the modular API itself.",
    baseline: {
      description:
        "Copy every check object, replacing its command with spread syntax -- no package.",
      sampling: SLOW,
      setup: (n) => ({ checks: checksOf(n) }),
      run: ({ checks }) =>
        Object.fromEntries(
          Object.entries(checks).map(([id, check]) => [id, { ...check, run: ["node", "x.mjs"] }]),
        ),
    },
    withPackage: {
      description:
        "`withEvidence` replaces the command of every check, keeping each check's own policy.",
      sampling: SLOW,
      setup: (n) => ({ checks: checksOf(n) }),
      run: ({ checks }) =>
        Object.fromEntries(
          Object.entries(checks).map(([id, check]) => [
            id,
            parts.withEvidence(check, { run: ["node", "x.mjs"] }),
          ]),
        ),
    },
    variables: [CHECKS, SHAPE, RUNTIME],
  },
  functions: [
    one(
      "evidence-of",
      "evidenceOf",
      "Runs when a consumer inspects or reuses the way a standard check collects its evidence.",
      ({ check }) => parts.evidenceOf(check),
    ),
    one(
      "policy-of",
      "policyOf",
      "Runs when a consumer reuses a standard check's rule over its own evidence.",
      ({ check }) => parts.policyOf(check),
    ),
    one(
      "compose-check",
      "composeCheck",
      "Builds every custom check from an evidence half and a policy half.",
      ({ check }) => parts.composeCheck(parts.evidenceOf(check), check.policy),
    ),
    one(
      "with-policy",
      "withPolicy",
      "The way a consumer keeps the standard's evidence and judges it by its own rule.",
      ({ check }) => parts.withPolicy(check, policy),
    ),
    one(
      "with-evidence",
      "withEvidence",
      "The way a consumer keeps the standard's rule and collects the evidence its own way.",
      ({ check }) => parts.withEvidence(check, { run: ["node", "x.mjs"] }),
    ),
    {
      id: "evidence-of-all",
      name: "evidenceOfAll",
      why: "Splits a whole check set, such as the standard, in one call; it runs when a tool lists or inspects how every check collects evidence.",
      poorPerformanceMeans:
        "Tools that show or compare every check's evidence (a dry run, an editor) would pause on every refresh as the set grows.",
      expectedComplexity: "linear",
      complexityReason:
        "It visits every check once and copies its fields without the policy. Past about a thousand checks V8 turns the result object into a hash table, a one-time step in the curve the fit cannot classify; the standard holds about fifty.",
      variables: [CHECKS, SHAPE, RUNTIME],
      sampling: { ...SLOW, minIterations: 10, maxIterations: 30 },
      setup: (n) => ({ checks: checksOf(n) }),
      run: ({ checks }) => parts.evidenceOfAll(checks),
    },
    {
      id: "policies-of-all",
      name: "policiesOfAll",
      why: "Collects every policy of a check set in one call, for a tool that reuses the standard's rules on its own evidence.",
      poorPerformanceMeans:
        "A tool that evaluates the rules of the whole standard would pause on every call as the set grows.",
      expectedComplexity: "linear",
      complexityReason:
        "It visits every check once and picks out its policy. Past about a thousand checks V8 turns the result object into a hash table, a one-time step in the curve the fit cannot classify; the standard holds about fifty.",
      variables: [CHECKS, SHAPE, RUNTIME],
      sampling: { ...SLOW, minIterations: 10, maxIterations: 30 },
      setup: (n) => ({ checks: checksOf(n) }),
      run: ({ checks }) => parts.policiesOfAll(checks),
    },
    {
      id: "parse-tool-envelope",
      name: "parseToolEnvelope",
      why: "Every evidence-script-backed check reads its result through it, so it runs once per such check in every contract run, including on the failure path where tools print the most.",
      poorPerformanceMeans:
        "Reading a failing check's output would slow with how much the tool printed, and a tool that prints megabytes of logs would stall the verdict.",
      expectedComplexity: "constant",
      complexityReason:
        "On success the envelope is already parsed by the engine, so it only checks its shape; the variant that must quote the tool's output below is the only one that reads text.",
      variables: [
        {
          name: "output size",
          how: "variant",
          description:
            "A parsed envelope versus a tool that printed n characters before failing to produce one.",
        },
        RUNTIME,
      ],
      variants: [
        {
          name: "parsed-envelope",
          description: "The tool printed a well-formed JSON envelope.",
          options: { printed: false },
        },
        {
          name: "unparseable-output",
          description: "The tool printed text and no envelope; the verdict quotes what it printed.",
          options: { printed: true },
          expectedComplexity: "constant",
          complexityReason:
            "Quoting the output trims and joins it, and V8 shares the underlying string for both, so the cost does not depend on how much the tool printed.",
        },
      ],
      notCovered: [
        {
          name: "abnormal termination",
          reason: "A killed or timed-out tool takes a separate, constant-cost early return.",
        },
      ],
      sampling: SLOW,
      setup: (n, options) => ({
        result:
          options?.printed === true
            ? {
                stdout: "x".repeat(n * 100),
                stderr: "",
                exitCode: 0,
                status: "completed",
                output: { success: false },
              }
            : {
                stdout: "",
                stderr: "",
                exitCode: 0,
                status: "completed",
                output: { success: true, value: { ok: true } },
              },
      }),
      run: ({ result }) => shared.parseToolEnvelope(result, "tool", "Check:"),
    },
    {
      id: "standard-checks",
      name: "standardChecks",
      why: "Assembles the whole standard; a consumer's contract.ts calls it on every contract run, every `--help` and every editor refresh.",
      poorPerformanceMeans:
        "Every invocation of the contract CLI would pause before doing any work.",
      expectedComplexity: "constant",
      complexityReason:
        "The standard has a fixed number of checks, each resolved once (its tool config looked up on disk), so cost does not depend on the workload size.",
      variables: [
        {
          name: "tool config lookups",
          how: "fixed",
          value: "the repository's own",
          description:
            "A consumer with more config files to probe pays slightly more filesystem calls.",
        },
        RUNTIME,
      ],
      notCovered: [
        {
          name: "cold module load",
          reason: "The first call also loads every check module; the measured calls are warm.",
        },
      ],
      sampling: SLOW,
      setup: () => ({}),
      run: () => standard.standardChecks(),
    },
  ],
})
