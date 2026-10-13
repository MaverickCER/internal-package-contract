// internal-package-contract benchmark suite: documenting a package's environment (`env`, `EnvContract`). The cost
// is development and CI cost, paid on every contract run that includes the check and every `env` command: the
// contract file is read and parsed by env-cap, never executed, and the document is rendered and formatted in
// memory. See ../READING-BENCHMARKS.md and ../WRITING-BENCHMARKS.md.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { register } from "tsx/esm/api"
import { defineSuite } from "../../scripts/benchmark/kit/index.mjs"
import { inspectEnv, SCHEMA_PATH, syncRotationIssue } from "../../scripts/env/run.mjs"

register()
const { envContractCheck } = await import("../../checks/env-contract.ts")

const SLOW = { warmupIterations: 1, minIterations: 3, maxIterations: 8, targetDurationMs: 1500 }
const scratch = mkdtempSync(path.join(tmpdir(), "ipc-env-bench-"))
const made = new Map()

/** A contract of `n` documented variables, written once per size and shared by every sample. */
function project(n) {
  if (!made.has(n)) {
    const dir = path.join(scratch, String(n))
    mkdirSync(path.join(dir, "ci"), { recursive: true })
    const names = Array.from({ length: n }, (_, i) => `VARIABLE_${String(i).padStart(5, "0")}`)
    writeFileSync(
      path.join(dir, SCHEMA_PATH),
      [
        'import { createEnv, documentEnv } from "internal-package-contract/env-cap"',
        "const accept = (): true => true",
        `const schema = { ${names.map((name) => `${name}: { default: "", validator: accept }`).join(", ")} }`,
        'export const ciEnv = createEnv(schema, { name: "ci" })',
        `documentEnv(schema, { category: "CI", variables: { ${names.map((name) => `${name}: { description: "Variable ${name}.", owner: "maintainers", refreshInstructions: "Replace the secret.", sensitivity: "secret", expiresAt: "2999-01-01" }`).join(", ")} } })`,
      ].join("\n"),
    )
    made.set(n, dir)
  }
  return made.get(n)
}

const VARIABLES = {
  name: "documented variables",
  how: "swept",
  description: "The tier axis: how many variables the contract documents.",
}
const SHAPE = {
  name: "variable shape",
  how: "fixed",
  value: "a default, a validator, an owner, refresh instructions and a far expiry",
  description:
    "A contract with longer descriptions renders more text; the growth class does not change.",
}
const DISK = {
  name: "filesystem",
  how: "fixed",
  value: "local SSD",
  description: "A network or virtual filesystem adds latency to the two files read; not covered.",
}
const RUNTIME = {
  name: "runtime",
  how: "fixed",
  value: "Node (V8)",
  description: "Measured on Node only.",
}

const findings = (n) =>
  Array.from({ length: n }, (_, i) => ({
    severity: "warning",
    code: i % 2 === 0 ? "EXPIRING_SOON" : "EXPIRED",
    message: `"VARIABLE_${String(i)}" expires soon.`,
  }))

export default defineSuite({
  package: { name: "internal-package-contract" },
  workload: {
    unit: "variable",
    description:
      "One variable documented in ci/env.schema.ts. A package documents a handful; 80 is already generous, and the ladder goes far beyond to expose any super-linear behavior.",
    typicalN: 80,
  },
  tiers: [20, 40, 80, 160, 320, 640, 1280, 2560],
  endToEnd: {
    purpose:
      "Shows what a contract run pays to read and judge the environment contract, against the floor of reading the contract file as text. The difference is env-cap's parsing, the rendering of the document and its formatting with the package's own Prettier settings.",
    baseline: {
      description: "Read the contract file as text -- no package.",
      sampling: SLOW,
      setup: (n) => ({ dir: project(n) }),
      run: ({ dir }) => readFileSync(path.join(dir, SCHEMA_PATH), "utf8").length,
    },
    withPackage: {
      description:
        "`inspectEnv` parses the contract, collects what is expiring and decides whether the document is current.",
      sampling: SLOW,
      setup: (n) => ({ dir: project(n) }),
      run: ({ dir }) => inspectEnv({ cwd: dir }),
    },
    variables: [VARIABLES, SHAPE, DISK, RUNTIME],
  },
  functions: [
    {
      id: "inspect-env",
      name: "inspectEnv",
      why: "Runs once per contract run that includes the EnvContract check, and once per `env` and `doctor` call, so a package pays it on every run.",
      poorPerformanceMeans:
        "Every contract run and every `doctor` would wait longer for the same verdict as the contract grows; a super-linear parse would make a large contract the slowest check.",
      expectedComplexity: "linear",
      complexityReason:
        "env-cap parses the file once and renders one entry per variable, and the formatter makes one pass over the text, so cost is proportional to the number of variables.",
      variables: [VARIABLES, SHAPE, DISK, RUNTIME],
      inEndToEnd: { callsPerOperation: 1, description: "Once per contract run." },
      sampling: SLOW,
      setup: (n) => ({ dir: project(n) }),
      run: ({ dir }) => inspectEnv({ cwd: dir }),
    },
    {
      id: "sync-rotation-issue",
      name: "syncRotationIssue",
      why: "Runs weekly in the rotation workflow to open, update or close the one issue that says which credentials are due.",
      poorPerformanceMeans:
        "The weekly job would take longer in proportion to how many credentials are due, which only matters at a size no package reaches.",
      expectedComplexity: "linear",
      complexityReason:
        "It filters the findings once and writes one line of the issue body for each due credential.",
      variables: [
        {
          name: "findings",
          how: "swept",
          description: "The tier axis: how many findings the report holds, half of them due.",
        },
        {
          name: "GitHub CLI",
          how: "fixed",
          value: "a stand-in that answers at once",
          description:
            "The real CLI adds a network round trip per call; the benchmark isolates the package's own work, as the standard asks.",
        },
        RUNTIME,
      ],
      inEndToEnd: {
        callsPerOperation: 0,
        description: "Not part of a contract run; it runs weekly in its own workflow.",
      },
      sampling: SLOW,
      setup: (n) => ({ report: { findings: findings(n) } }),
      run: ({ report }) => syncRotationIssue(report, () => ({ status: 0, stdout: "" })),
    },
    {
      id: "env-contract-policy",
      name: "EnvContract policy",
      why: "Judges the evidence of every contract run that includes the check.",
      poorPerformanceMeans:
        "The verdict of the whole run would wait on it; it only formats the problems it was handed.",
      expectedComplexity: "linear",
      complexityReason: "It writes one line for each finding it was given.",
      variables: [
        {
          name: "findings",
          how: "swept",
          description: "The tier axis: how many findings the evidence reports.",
        },
        RUNTIME,
      ],
      inEndToEnd: {
        callsPerOperation: 1,
        description: "Once per contract run, after the evidence is collected.",
      },
      sampling: SLOW,
      setup: (n) => ({
        policy: envContractCheck().policy,
        context: {
          result: {
            command: "node",
            args: [],
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            durationMs: 1000,
            exitCode: 0,
            signal: null,
            stdout: "",
            stderr: "",
            status: "completed",
            output: {
              format: "json",
              success: true,
              value: { ok: true, state: "present", contracts: 1, findings: findings(n), stale: [] },
            },
          },
        },
      }),
      run: ({ policy, context }) => policy(context),
    },
  ],
})
