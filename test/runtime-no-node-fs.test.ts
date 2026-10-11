import { RuleTester } from "eslint"
import type { Rule } from "eslint"
import { describe, expect, it } from "vitest"
import { createNoNodeFs } from "../runtime/no-node-fs.js"

const noNodeFs = createNoNodeFs({
  docsUrl: (name) => `https://example.test/docs#${name}`,
  adr: "ADR 7",
  guide: "the demo guide",
})

// RuleTester needs vitest's `describe`/`it` and a rule typed as eslint's own RuleModule.
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } })

ruleTester.run("no-node-fs", noNodeFs as unknown as Rule.RuleModule, {
  valid: [
    // The executable capability boundary -- explicitly allowed.
    {
      code: `import fs from "node:fs/promises";`,
      filename: "src/cli/index.ts",
      options: [{ allow: ["src/cli/**"] }],
    },
    // Not a filesystem module.
    { code: `import path from "node:path";`, filename: "src/build/discover.ts" },
    { code: `import { foo } from "./local-fs.js";`, filename: "src/build/discover.ts" },
    { code: `import { foo } from "fs-extra";`, filename: "src/build/discover.ts" },
    // A same-line disable still works.
    {
      code: `// eslint-disable-next-line\nimport fs from "node:fs";`,
      filename: "src/build/discover.ts",
    },
    // require() of something else.
    { code: `const x = require("node:path");`, filename: "src/build/discover.ts" },
    // A call that isn't `require` -- must fall straight through the guard,
    // even when its argument names a filesystem module.
    { code: `loadModule("node:fs");`, filename: "src/build/discover.ts" },
    // A member-expression callee named `require` (e.g. `foo.require(...)`) is
    // not the global `require` -- also falls through.
    { code: `mod.require("node:fs");`, filename: "src/build/discover.ts" },
    // `require` with no argument, or a non-literal argument -- nothing to check.
    { code: `require();`, filename: "src/build/discover.ts" },
    { code: `const spec = "node:fs"; require(spec);`, filename: "src/build/discover.ts" },
    // A non-string literal argument to `require` -- `fsSpecifier` must reject it.
    { code: `require(42);`, filename: "src/build/discover.ts" },
    // dynamic import of something else.
    { code: `const p = import("./other.js");`, filename: "src/build/discover.ts" },
    // dynamic import with a non-literal source -- nothing statically to check.
    { code: `const name = "node:fs"; const p = import(name);`, filename: "src/build/discover.ts" },
  ],
  invalid: [
    {
      code: `import fs from "node:fs/promises";`,
      filename: "src/build/discover.ts",
      errors: [{ messageId: "noNodeFs", data: { specifier: "node:fs/promises" } }],
    },
    {
      code: `import { readFile } from "node:fs";`,
      filename: "src/build/generate-manifest.ts",
      errors: [{ messageId: "noNodeFs", data: { specifier: "node:fs" } }],
    },
    {
      code: `import { promises as fs } from "fs";`,
      filename: "src/build/check-artifacts.ts",
      errors: [{ messageId: "noNodeFs", data: { specifier: "fs" } }],
    },
    {
      code: `import x from "fs/promises";`,
      filename: "src/helpers/index.ts",
      errors: [{ messageId: "noNodeFs", data: { specifier: "fs/promises" } }],
    },
    {
      code: `const fs = require("node:fs");`,
      filename: "src/build/discover.ts",
      errors: [{ messageId: "noNodeFs", data: { specifier: "node:fs" } }],
    },
    {
      code: `const fs = require("fs/promises");`,
      filename: "src/build/discover.ts",
      errors: [{ messageId: "noNodeFs", data: { specifier: "fs/promises" } }],
    },
    {
      code: `const fs = await import("node:fs");`,
      filename: "src/build/discover.ts",
      errors: [{ messageId: "noNodeFs", data: { specifier: "node:fs" } }],
    },
    // The allow list doesn't match this file -- still flagged.
    {
      code: `import fs from "node:fs";`,
      filename: "src/build/discover.ts",
      options: [{ allow: ["src/cli/**"] }],
      errors: [{ messageId: "noNodeFs" }],
    },
  ],
})

describe("createNoNodeFs wording", () => {
  const rule = createNoNodeFs({
    docsUrl: (name) => `https://example.test/docs#${name}`,
    adr: "ADR 7",
    guide: "the demo guide",
  })
  it("links the rule's documentation through the supplied function", () => {
    expect(rule.meta.docs?.url).toBe("https://example.test/docs#no-node-fs")
  })
  it("cites the supplied decision record and guide, and no other package's", () => {
    expect(rule.meta.messages["noNodeFs"]).toContain(
      "(see ADR 7 / the demo guide for the allow-list escape hatch).",
    )
  })
})
