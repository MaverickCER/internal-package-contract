import { describe, expect, it } from "vitest"
import { auditPins, collectPins, run } from "../scripts/pin-audit.mjs"

const A = "a".repeat(40)
const B = "b".repeat(40)
const WF = "MaverickCER/internal-package-contract/.github/workflows"
const yml = (sha: string, comment: string) => `    uses: ${WF}/release.yml@${sha}${comment}\n`
const lockText = (sha: string) =>
  JSON.stringify({
    packages: {
      "node_modules/internal-package-contract": {
        resolved: `git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${sha}`,
      },
    },
  })

type Reply = { ok: boolean; status: number; json?: unknown }
const fakeGh =
  (replies: Record<string, Reply>) =>
  async (apiPath: string): Promise<Reply> =>
    replies[apiPath] ?? { ok: false, status: 500 }
const compare = (sha: string) => `repos/MaverickCER/internal-package-contract/compare/main...${sha}`
const commit = (ref: string) => `repos/MaverickCER/internal-package-contract/commits/${ref}`

describe("collectPins", () => {
  it("lists the lockfile commit and each full-SHA workflow pin once, with where it was found", () => {
    const pins = collectPins({
      lockfile: lockText(A),
      workflows: [{ file: "r.yml", text: yml(B, " # v0.10.0") }],
    })
    expect(pins).toEqual([
      { where: "package-lock.json", sha: A, comment: "" },
      { where: "r.yml:1", sha: B, comment: "v0.10.0" },
    ])
  })
  it("skips pins that are not a full SHA (the offline check reports those)", () => {
    expect(
      collectPins({ lockfile: undefined, workflows: [{ file: "r.yml", text: yml("main", "") }] }),
    ).toEqual([])
  })
})

describe("auditPins", () => {
  const pins = [{ where: "r.yml:1", sha: A, comment: "v0.10.0" }]
  it("passes a commit on the default branch whose tag points at it", async () => {
    const gh = fakeGh({
      [compare(A)]: { ok: true, status: 200, json: { status: "behind" } },
      [commit("v0.10.0")]: { ok: true, status: 200, json: { sha: A } },
    })
    expect(await auditPins({ pins, gh })).toEqual({ problems: [], blocked: [] })
  })
  it("accepts an identical commit", async () => {
    const gh = fakeGh({ [compare(A)]: { ok: true, status: 200, json: { status: "identical" } } })
    expect((await auditPins({ pins: [{ ...pins[0]!, comment: "" }], gh })).problems).toEqual([])
  })
  it.each(["ahead", "diverged"])(
    "fails a commit that is %s of the default branch",
    async (status) => {
      const gh = fakeGh({
        [compare(A)]: { ok: true, status: 200, json: { status } },
        [commit("v0.10.0")]: { ok: true, status: 200, json: { sha: A } },
      })
      const result = await auditPins({ pins, gh })
      expect(result.problems).toEqual([expect.stringContaining("not reachable from main")])
      expect(result.problems[0]).toContain("r.yml:1")
    },
  )
  it("fails a commit the repository does not have", async () => {
    const gh = fakeGh({ [compare(A)]: { ok: false, status: 404 } })
    const result = await auditPins({ pins: [{ ...pins[0]!, comment: "" }], gh })
    expect(result.problems).toEqual([expect.stringContaining("does not exist")])
  })
  it("fails a release comment whose tag points elsewhere, or does not exist", async () => {
    const reachable = { ok: true, status: 200, json: { status: "behind" } }
    const moved = fakeGh({
      [compare(A)]: reachable,
      [commit("v0.10.0")]: { ok: true, status: 200, json: { sha: B } },
    })
    expect((await auditPins({ pins, gh: moved })).problems).toEqual([
      expect.stringContaining(`v0.10.0 is ${B.slice(0, 7)}, not ${A.slice(0, 7)}`),
    ])
    const missing = fakeGh({
      [compare(A)]: reachable,
      [commit("v0.10.0")]: { ok: false, status: 404 },
    })
    expect((await auditPins({ pins, gh: missing })).problems).toEqual([
      expect.stringContaining("no tag v0.10.0"),
    ])
  })
  it("reports blocked, never a pass, when GitHub cannot be asked", async () => {
    const result = await auditPins({ pins, gh: fakeGh({}) })
    expect(result.problems).toEqual([])
    expect(result.blocked).toHaveLength(2)
    expect(result.blocked[0]).toContain("r.yml:1")
  })
  it("checks each distinct commit once", async () => {
    const seen: string[] = []
    const gh = async (apiPath: string): Promise<Reply> => {
      seen.push(apiPath)
      return { ok: true, status: 200, json: { status: "identical", sha: A } }
    }
    await auditPins({
      pins: [
        { where: "a", sha: A, comment: "" },
        { where: "b", sha: A, comment: "" },
      ],
      gh,
    })
    expect(seen).toEqual([compare(A)])
  })
})

describe("run", () => {
  const io = () => {
    const out: string[] = []
    return { out, io: { out: (t: string) => out.push(t), err: (t: string) => out.push(t) } }
  }
  const files = { lockfile: lockText(A), workflows: [] }
  it("exits 0 with a summary when every pin is fine", async () => {
    const { out, io: sink } = io()
    const gh = fakeGh({ [compare(A)]: { ok: true, status: 200, json: { status: "behind" } } })
    expect(await run({ ...files, gh, io: sink })).toBe(0)
    expect(out.join("")).toContain("1 pin")
  })
  it("exits 1 and prints each problem", async () => {
    const { out, io: sink } = io()
    const gh = fakeGh({ [compare(A)]: { ok: true, status: 200, json: { status: "ahead" } } })
    expect(await run({ ...files, gh, io: sink })).toBe(1)
    expect(out.join("")).toContain("not reachable")
  })
  it("exits 2 when blocked", async () => {
    const { out, io: sink } = io()
    expect(await run({ ...files, gh: fakeGh({}), io: sink })).toBe(2)
    expect(out.join("")).toContain("blocked")
  })
  it("exits 0 and says so when the repository pins nothing", async () => {
    const { out, io: sink } = io()
    expect(
      await run({
        lockfile: undefined,
        workflows: [],
        gh: fakeGh({}),
        io: sink,
      }),
    ).toBe(0)
    expect(out.join("")).toContain("pins nothing")
  })
})
