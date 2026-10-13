import { describe, expect, it } from "vitest"
import { findRegions, replaceRegions } from "../scripts/generate/regions.mjs"

const doc = (body: string) =>
  `# T\n\nprose\n\n<!-- ipc:begin entry-points -->\n${body}<!-- ipc:end entry-points -->\n\nafter\n`

describe("findRegions", () => {
  it("finds a region's name and the span between its markers", () => {
    const text = doc("old\n")
    const { regions, problems } = findRegions(text)
    expect(problems).toEqual([])
    expect(regions).toHaveLength(1)
    expect(regions[0]?.name).toBe("entry-points")
    expect(text.slice(regions[0]!.start, regions[0]!.end)).toBe("old\n")
  })
  it("finds several regions and tolerates trailing spaces on a marker line", () => {
    const text =
      "<!-- ipc:begin a -->  \nx\n<!-- ipc:end a -->\n<!-- ipc:begin b-2 -->\n<!-- ipc:end b-2 -->  \n"
    const { regions, problems } = findRegions(text)
    expect(problems).toEqual([])
    expect(regions.map((r) => r.name)).toEqual(["a", "b-2"])
  })
  it("reports a region with no end marker, on the line it starts", () => {
    expect(findRegions("x\n<!-- ipc:begin a -->\nbody\n").problems).toEqual([
      { line: 2, message: 'region "a" has no end marker.' },
    ])
  })
  it("reports an end marker with no begin, and one that closes the wrong region", () => {
    expect(findRegions("<!-- ipc:end a -->\n").problems).toEqual([
      { line: 1, message: 'end marker for "a" has no begin marker.' },
    ])
    expect(
      findRegions("<!-- ipc:begin a -->\n<!-- ipc:end b -->\n<!-- ipc:end a -->\n").problems,
    ).toEqual([
      {
        line: 2,
        message: 'end marker for "b" closes the wrong region; "a" is open (opened on line 1).',
      },
    ])
  })
  it("reports a region that starts inside another, and a repeated name", () => {
    expect(
      findRegions(
        "<!-- ipc:begin a -->\n<!-- ipc:begin b -->\n<!-- ipc:end b -->\n<!-- ipc:end a -->\n",
      ).problems[0],
    ).toEqual({
      line: 2,
      message: 'region "b" starts inside region "a", which is still open (opened on line 1).',
    })
    expect(
      findRegions(
        "<!-- ipc:begin a -->\n<!-- ipc:end a -->\n<!-- ipc:begin a -->\n<!-- ipc:end a -->\n",
      ).problems,
    ).toEqual([
      { line: 3, message: 'region "a" appears more than once.' },
      { line: 4, message: 'end marker for "a" has no begin marker.' },
    ])
  })
  it("ignores text that only looks like a marker", () => {
    const { regions, problems } = findRegions(
      "<!-- ipc:begin A -->\n  <!-- ipc:begin a -->\n<!-- ipc:begin a --> x\nipc:begin a\n",
    )
    expect(regions).toEqual([])
    expect(problems).toEqual([])
  })
})

describe("replaceRegions", () => {
  it("replaces only what is between the markers, leaving a blank line each side of the body", () => {
    const text = doc("old\nlines\n")
    const { regions } = findRegions(text)
    expect(replaceRegions(text, regions, (name) => `new for ${name}`)).toBe(
      "# T\n\nprose\n\n<!-- ipc:begin entry-points -->\n\nnew for entry-points\n\n<!-- ipc:end entry-points -->\n\nafter\n",
    )
  })
  it("is stable: replacing again with the same body changes nothing", () => {
    const once = replaceRegions(doc("old\n"), findRegions(doc("old\n")).regions, () => "body")
    const again = replaceRegions(once, findRegions(once).regions, () => "body")
    expect(again).toBe(once)
  })
  it("replaces every region and keeps the text between and after them", () => {
    const text =
      "a\n<!-- ipc:begin x -->\n1\n<!-- ipc:end x -->\nb\n<!-- ipc:begin y -->\n2\n<!-- ipc:end y -->\nc\n"
    expect(replaceRegions(text, findRegions(text).regions, (name) => name.toUpperCase())).toBe(
      "a\n<!-- ipc:begin x -->\n\nX\n\n<!-- ipc:end x -->\nb\n<!-- ipc:begin y -->\n\nY\n\n<!-- ipc:end y -->\nc\n",
    )
  })
  it("returns the text unchanged when there are no regions", () => {
    expect(replaceRegions("plain\n", [], () => "x")).toBe("plain\n")
  })
})
