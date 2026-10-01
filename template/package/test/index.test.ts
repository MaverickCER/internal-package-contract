import { describe, expect, it } from "vitest"
import { packageName } from "../src/index.js"

describe("packageName", () => {
  it("names the package", () => {
    expect(packageName()).toBe("{{name}}")
  })
})
