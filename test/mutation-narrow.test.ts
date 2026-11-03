import { describe, expect, it } from "vitest"
import { narrowMutation } from "../scripts/mutation/narrow.mjs"

describe("narrowMutation", () => {
  it("restricts nothing for a run that is not narrowed", () => {
    expect(narrowMutation(undefined)).toEqual({ skip: false, args: [], key: "" })
    expect(narrowMutation({ scope: "full" })).toEqual({ skip: false, args: [], key: "" })
    expect(narrowMutation({ scope: "full", mutate: ["src/a.ts"] })).toEqual({
      skip: false,
      args: [],
      key: "",
    })
  })

  it("mutates only the affected sources, and keys the restriction by them", () => {
    expect(narrowMutation({ scope: "affected", mutate: ["src/a.ts", "src/b.ts"] })).toEqual({
      skip: false,
      args: ["--mutate", "src/a.ts,src/b.ts"],
      key: "src/a.ts,src/b.ts",
    })
    expect(narrowMutation({ scope: "affected", mutate: ["src/a.ts"] })).toEqual({
      skip: false,
      args: ["--mutate", "src/a.ts"],
      key: "src/a.ts",
    })
  })

  it("skips mutation when no source is affected, and keys that differently from any list", () => {
    expect(narrowMutation({ scope: "affected", mutate: [] })).toEqual({
      skip: true,
      args: [],
      key: "nothing",
    })
    expect(narrowMutation({ scope: "affected" })).toEqual({ skip: true, args: [], key: "nothing" })
  })
})
