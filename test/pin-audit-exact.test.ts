import { describe, expect, it } from "vitest"
import { auditPins, run } from "../scripts/pin-audit.mjs"

const A = "a".repeat(40)
const B = "b".repeat(40)
type Reply = { ok: boolean; status: number; json?: unknown }
const R = "repos/MaverickCER/internal-package-contract"
const gh =
  (replies: Record<string, Reply>) =>
  async (p: string): Promise<Reply> =>
    replies[p] ?? { ok: false, status: 500 }

describe("auditPins (exact messages)", () => {
  it("shortens the commit to seven characters in every message", async () => {
    const result = await auditPins({
      pins: [{ where: "w.yml:3", sha: A, comment: "v1.0.0" }],
      gh: gh({
        [`${R}/compare/main...${A}`]: { ok: true, status: 200, json: { status: "ahead" } },
        [`${R}/commits/v1.0.0`]: { ok: true, status: 200, json: { sha: B } },
      }),
    })
    expect(result.problems).toEqual([
      "w.yml:3: aaaaaaa is not reachable from main (it is ahead); it was never merged, or was rewritten away.",
      "w.yml:3: tag v1.0.0 is bbbbbbb, not aaaaaaa; the comment and the pin name different commits.",
    ])
  })
  it("only looks up a comment that starts with a version", async () => {
    const asked: string[] = []
    await auditPins({
      pins: [{ where: "w", sha: A, comment: "see v1" }],
      gh: async (p) => (asked.push(p), { ok: true, status: 200, json: { status: "identical" } }),
    })
    expect(asked).toEqual([`${R}/compare/main...${A}`])
  })
  it("words a blocked tag lookup exactly", async () => {
    const result = await auditPins({
      pins: [{ where: "w", sha: A, comment: "v1" }],
      gh: gh({
        [`${R}/compare/main...${A}`]: { ok: true, status: 200, json: { status: "behind" } },
      }),
    })
    expect(result.blocked).toEqual(["w: could not ask GitHub where tag v1 points (HTTP 500)."])
  })
})

describe("run (exact output)", () => {
  const files = {
    lockfile: JSON.stringify({
      packages: {
        "node_modules/internal-package-contract": { resolved: `git+ssh://x/y.git#${A}` },
      },
    }),
    workflows: [],
  }
  const collect = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
  }
  it("prints one bullet per line, ending in a newline", async () => {
    const c = collect()
    const code = await run({
      ...files,
      io: c.io,
      gh: gh({ [`${R}/compare/main...${A}`]: { ok: false, status: 404 } }),
    })
    expect(code).toBe(1)
    expect(c.err.join("")).toBe(
      `- package-lock.json: commit aaaaaaa does not exist in MaverickCER/internal-package-contract.\n`,
    )
  })
  it("lists blocked items under their own heading, one per line", async () => {
    const c = collect()
    await run({ ...files, io: c.io, gh: gh({}) })
    expect(c.err.join("")).toBe(
      "Pin audit blocked, not passed:\n- package-lock.json: could not ask GitHub whether aaaaaaa is reachable (HTTP 500).\n",
    )
  })
})
