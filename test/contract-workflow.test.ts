import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import { STRYKER_CONFIGS } from "../checks/strict.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const text = (file: string): string => readFileSync(path.join(root, file), "utf8")

interface Step {
  readonly name?: string
  readonly id?: string
  readonly if?: string
  readonly uses?: string
  readonly run?: string
  readonly with?: Readonly<Record<string, unknown>>
  readonly env?: Readonly<Record<string, string>>
}
interface Job {
  readonly if?: string
  readonly needs?: string | readonly string[]
  readonly uses?: string
  readonly with?: Readonly<Record<string, unknown>>
  readonly secrets?: unknown
  readonly permissions?: Readonly<Record<string, string>>
  readonly outputs?: Readonly<Record<string, string>>
  readonly strategy?: { readonly "fail-fast"?: boolean; readonly matrix?: unknown }
  readonly steps?: readonly Step[]
}
interface Workflow {
  readonly on: Readonly<Record<string, unknown>>
  readonly permissions?: Readonly<Record<string, string>>
  readonly jobs: Readonly<Record<string, Job>>
}

const reusable = parse(text(".github/workflows/contract.yml")) as Workflow
const ci = parse(text(".github/workflows/ci.yml")) as Workflow
const caller = parse(text("template/contract.yml")) as Workflow

/** @returns the one step of `job` whose `run` contains `needle`. */
function stepRunning(job: Job | undefined, needle: string): Step {
  const found = (job?.steps ?? []).filter((step) => step.run?.includes(needle) === true)
  expect(found, `exactly one step runs ${needle}`).toHaveLength(1)
  return found[0] as Step
}

describe("the reusable contract workflow", () => {
  const { plan, mutation, contract } = reusable.jobs

  it("runs only when another workflow calls it, with three inputs and an optional Socket key", () => {
    expect(Object.keys(reusable.on)).toEqual(["workflow_call"])
    const call = reusable.on["workflow_call"] as {
      inputs: Record<string, { type: string; default: unknown }>
      secrets: Record<string, { required: boolean }>
    }
    expect(
      Object.fromEntries(
        Object.entries(call.inputs).map(([name, input]) => [name, [input.type, input.default]]),
      ),
    ).toEqual({
      "node-version": ["string", "24.x"],
      "mutation-shards": ["boolean", true],
      "contract-args": ["string", ""],
    })
    expect(call.secrets).toEqual({
      SOCKET_SECURITY_API_KEY: expect.objectContaining({ required: false }),
    })
    expect(reusable.permissions).toEqual({ contents: "read" })
    expect(Object.keys(reusable.jobs)).toEqual(["plan", "mutation", "contract"])
  })

  it("pins every action by a full commit SHA with its release in a comment", () => {
    const uses = [
      ...text(".github/workflows/contract.yml").matchAll(/^ +(?:- )?uses: (\S+)(.*)$/gm),
    ]
    expect(uses.length).toBeGreaterThan(0)
    for (const [, action, comment] of uses) {
      expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
      expect(comment).toMatch(/^ # v\d/)
    }
  })

  it("pins the same action revisions as this repository's ci.yml", () => {
    const pins = (file: string): Map<string, string> =>
      new Map(
        [...text(file).matchAll(/uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40})/g)].map(
          ([, action, sha]) => [action as string, sha as string],
        ),
      )
    const own = pins(".github/workflows/ci.yml")
    for (const [action, sha] of pins(".github/workflows/contract.yml")) {
      if (own.has(action)) expect(sha, action).toBe(own.get(action))
    }
  })

  it("leaves no credential in any checkout", () => {
    for (const job of Object.values(reusable.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("actions/checkout@") === true) {
          expect(step.with?.["persist-credentials"]).toBe(false)
        }
      }
    }
  })

  it("plans the shards with repo-contract, from the package's own Stryker config or the bundled one", () => {
    expect(plan?.if).toBe("inputs.mutation-shards")
    const step = stepRunning(plan, "repo-contract mutation plan --json")
    expect(step.id).toBe("plan")
    expect(step.run).toContain("node_modules/internal-package-contract/config/stryker.config.mjs")
    expect(plan?.outputs).toEqual({
      matrix: "${{ steps.plan.outputs.matrix }}",
      total: "${{ steps.plan.outputs.total }}",
    })
  })

  it("looks for the package's own Stryker config under exactly the names the Mutation check does", () => {
    const step = stepRunning(plan, "repo-contract mutation plan --json")
    const names = /for name in ([^;]+); do/
      .exec(step.run ?? "")?.[1]
      ?.trim()
      .split(/\s+/)
    expect(names).toEqual([...STRYKER_CONFIGS])
    // A wildcard would also match a file Stryker never reads, such as stryker.config.ts.
    expect(step.run).not.toContain("find ")
  })

  it("mutates each planned shard through the contract's own Mutation check, and keeps every report", () => {
    expect(mutation?.needs).toBe("plan")
    expect(mutation?.if).toBe("inputs.mutation-shards")
    expect(mutation?.strategy).toEqual({
      "fail-fast": false,
      matrix: "${{ fromJSON(needs.plan.outputs.matrix) }}",
    })
    const step = stepRunning(mutation, "npm run contract -- --checks Mutation")
    expect(step.env).toEqual({ IPC_MUTATION_SHARD: "${{ matrix.spec }}" })
    const upload = mutation?.steps?.find((s) => s.uses?.startsWith("actions/upload-artifact@"))
    expect(upload?.if).toBe("always()")
    expect(upload?.with).toMatchObject({
      name: "mutation-shard-${{ matrix.shard }}",
      path: "reports/mutation/mutation.json",
      "if-no-files-found": "error",
    })
  })

  it("never skips the contract job: GitHub counts a skipped required job as passing", () => {
    expect(contract?.needs).toEqual(["plan", "mutation"])
    expect(contract?.if).toBe("always()")
    expect(contract?.permissions).toEqual({ contents: "read", "security-events": "read" })
  })

  it("fails the contract job when a shard did not pass, before anything else runs", () => {
    const first = contract?.steps?.[0]
    expect(first?.if).toBe("inputs.mutation-shards && needs.mutation.result != 'success'")
    expect(first?.run).toContain("exit 1")
  })

  it("refuses --scope with shards: a narrowed run cannot adopt the full merged report", () => {
    const step = contract?.steps?.[1]
    expect(step?.if).toBe("inputs.mutation-shards && contains(inputs.contract-args, '--scope')")
    expect(step?.run).toContain("exit 1")
  })

  it("merges the shard reports with repo-contract, where Stryker writes its own", () => {
    const step = stepRunning(contract, "repo-contract merge-mutation")
    expect(step.if).toBe("inputs.mutation-shards")
    expect(step.env).toEqual({ TOTAL: "${{ needs.plan.outputs.total }}" })
    expect(step.run).toContain('--total "$TOTAL" --out reports/mutation/mutation.json')
    expect(step.run).toContain('"$i=reports/shards/mutation-shard-$i/mutation.json"')
  })

  it("judges the merged report instead of mutating again, and only when it sharded", () => {
    const step = stepRunning(contract, "npm run contract --")
    expect(step.env).toEqual({
      CONTRACT_ARGS: "${{ inputs.contract-args }}",
      IPC_MUTATION_REPORT:
        "${{ inputs.mutation-shards && 'reports/mutation/mutation.json' || '' }}",
      SOCKET_SECURITY_API_KEY: "${{ secrets.SOCKET_SECURITY_API_KEY }}",
      GH_TOKEN: "${{ github.token }}",
    })
    const names = (contract?.steps ?? []).map((s) => s.run ?? s.uses ?? "")
    const merge = names.findIndex((name) => name.includes("repo-contract merge-mutation"))
    expect(merge).toBeGreaterThan(-1)
    expect(names.findIndex((name) => name.includes("npm run contract --"))).toBeGreaterThan(merge)
  })
})

describe("this repository's own ci.yml", () => {
  it("runs the contract through the reusable workflow by its local path", () => {
    const standard = ci.jobs["standard"]
    expect(standard?.uses).toBe("./.github/workflows/contract.yml")
    expect(standard?.permissions).toEqual({ contents: "read", "security-events": "read" })
    expect(standard?.secrets).toEqual({
      SOCKET_SECURITY_API_KEY: "${{ secrets.SOCKET_SECURITY_API_KEY }}",
    })
  })

  it("keeps a bare `contract` job, the status check the ruleset and release.yml look for", () => {
    const contract = ci.jobs["contract"]
    expect(contract?.needs).toBe("standard")
    expect(contract?.if).toBe("always()")
    expect(ci.jobs["self-check"]?.needs).toBe("contract")
  })

  it("passes each job result through env, as the template does, never into the script", () => {
    for (const [job, needed] of [
      ["contract", "standard"],
      ["self-check", "contract"],
    ] as const) {
      expect(ci.jobs[job]?.steps, job).toEqual([
        { env: { RESULT: `\${{ needs.${needed}.result }}` }, run: 'test "$RESULT" = success' },
      ])
    }
  })
})

describe("the contract.yml init writes into a package", () => {
  it("calls the reusable workflow pinned by commit, with the token's read scopes and the Socket key", () => {
    const standard = caller.jobs["standard"]
    expect(standard?.uses).toBe(
      "MaverickCER/internal-package-contract/.github/workflows/contract.yml@{{ipcSha}}",
    )
    expect(text("template/contract.yml")).toContain(
      "uses: MaverickCER/internal-package-contract/.github/workflows/contract.yml@{{ipcSha}} # {{ipcRef}}\n",
    )
    expect(standard?.permissions).toEqual({ contents: "read", "security-events": "read" })
    expect(standard?.secrets).toEqual({
      SOCKET_SECURITY_API_KEY: "${{ secrets.SOCKET_SECURITY_API_KEY }}",
    })
    // Shards on and a full run: the reusable workflow's defaults.
    expect(standard?.with).toBeUndefined()
  })

  it("keeps the bare `contract` and `required` jobs the ruleset and BranchProtection require", () => {
    const contract = caller.jobs["contract"]
    expect(contract?.needs).toBe("standard")
    expect(contract?.if).toBe("always()")
    expect(contract?.steps).toHaveLength(1)
    expect(contract?.steps?.[0]?.env).toEqual({ RESULT: "${{ needs.standard.result }}" })
    expect(contract?.steps?.[0]?.run).toBe('test "$RESULT" = success')
    expect(caller.jobs["required"]?.needs).toEqual(["standard", "node-floor", "typescript-7"])
    expect(caller.jobs["required"]?.if).toBe("always()")
  })

  it("runs no contract steps of its own: the standard is the reusable workflow's", () => {
    expect(text("template/contract.yml")).not.toMatch(/npm run contract/)
    expect(Object.keys(caller.jobs)).toEqual([
      "standard",
      "contract",
      "node-floor",
      "typescript-7",
      "required",
    ])
  })
})
