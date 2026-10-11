import { describe, expect, it } from "vitest"
import { linkinatorArgs } from "../scripts/docs-links-args.mjs"

describe("linkinatorArgs", () => {
  it("keeps the requested crawl and the JSON output", () => {
    const args = linkinatorArgs(["README.md", "--recurse"])
    expect(args.slice(0, 2)).toEqual(["README.md", "--recurse"])
    expect(args.slice(-2)).toEqual(["--format", "json"])
  })
  it("limits concurrency so a document with many GitHub links is not throttled", () => {
    const args = linkinatorArgs([])
    expect(Number(args[args.indexOf("--concurrency") + 1])).toBeLessThanOrEqual(5)
  })
  it("retries rate limits, retries server errors with jitter, and bounds every request", () => {
    const args = linkinatorArgs([])
    expect(args).toContain("--retry")
    expect(args).toContain("--retry-errors")
    expect(Number(args[args.indexOf("--retry-errors-count") + 1])).toBeGreaterThanOrEqual(3)
    expect(Number(args[args.indexOf("--retry-errors-jitter") + 1])).toBeGreaterThan(0)
    expect(Number(args[args.indexOf("--timeout") + 1])).toBeGreaterThan(0)
  })
})
