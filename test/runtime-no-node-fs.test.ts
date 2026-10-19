import { RuleTester } from "eslint"
import type { Rule } from "eslint"
import tseslint from "typescript-eslint"
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

// ESLint gives a rule the absolute path of the file; an allow pattern is written relative to the working directory.
const cwd = process.cwd()
const allowCli = [{ allow: ["src/cli/**"] }]

ruleTester.run(
  "no-node-fs: re-exports and allow patterns",
  noNodeFs as unknown as Rule.RuleModule,
  {
    valid: [
      { code: `export const x = 1;`, filename: "src/build/discover.ts" },
      { code: `const x = 1; export { x };`, filename: "src/build/discover.ts" },
      { code: `export { x } from "./local.js";`, filename: "src/build/discover.ts" },
      { code: `export * from "node:path";`, filename: "src/build/discover.ts" },
      // An absolute path inside the working directory, as a real run passes it.
      {
        code: `import fs from "node:fs";`,
        filename: `${cwd}/src/cli/index.ts`,
        options: allowCli,
      },
      // The same on Windows, where the separator is a backslash.
      {
        code: `import fs from "node:fs";`,
        filename: `${cwd}\\src\\cli\\index.ts`,
        options: allowCli,
      },
    ],
    invalid: [
      {
        code: `export { readFile } from "node:fs";`,
        filename: "src/build/discover.ts",
        errors: [{ messageId: "noNodeFs", data: { specifier: "node:fs" } }],
      },
      {
        code: `export * from "fs/promises";`,
        filename: "src/build/discover.ts",
        errors: [{ messageId: "noNodeFs", data: { specifier: "fs/promises" } }],
      },
      // A folder whose name only starts like the working directory is not inside it.
      {
        code: `import fs from "node:fs";`,
        filename: `${cwd}Xsrc/cli/index.ts`,
        options: allowCli,
        errors: [{ messageId: "noNodeFs" }],
      },
      // A path outside the working directory is matched only as given.
      {
        code: `import fs from "node:fs";`,
        filename: `${"z".repeat(cwd.length)}/src/cli/index.ts`,
        options: allowCli,
        errors: [{ messageId: "noNodeFs" }],
      },
    ],
  },
)

ruleTester.run(
  "no-node-fs: templates and getBuiltinModule",
  noNodeFs as unknown as Rule.RuleModule,
  {
    valid: [
      // A template with a substitution cannot be read statically.
      { code: "const x = 'fs'; const p = import(`node:${x}`);", filename: "src/build/discover.ts" },
      { code: "const x = 'fs'; require(`node:${x}`);", filename: "src/build/discover.ts" },
      { code: 'process.getBuiltinModule("node:path");', filename: "src/build/discover.ts" },
      // Only the text before a `${}` would name `fs`: still not statically known.
      { code: "const x = '/promises'; require(`fs${x}`);", filename: "src/build/discover.ts" },
      // A computed member, even one whose key is a variable named like the method.
      {
        code: 'const getBuiltinModule = "x"; process[getBuiltinModule]("node:fs");',
        filename: "src/build/discover.ts",
      },
      // Not the global `process`, not the method, or a computed property name.
      { code: 'other.getBuiltinModule("node:fs");', filename: "src/build/discover.ts" },
      { code: 'process.getOtherModule("node:fs");', filename: "src/build/discover.ts" },
      { code: 'process["getBuiltinModule"]("node:fs");', filename: "src/build/discover.ts" },
      { code: "process.getBuiltinModule;", filename: "src/build/discover.ts" },
      { code: 'getBuiltinModule("node:fs");', filename: "src/build/discover.ts" },
      { code: 'a.b.getBuiltinModule("node:fs");', filename: "src/build/discover.ts" },
      { code: 'process.versions.getBuiltinModule("node:fs");', filename: "src/build/discover.ts" },
      // A chained call's callee is itself a call, with no object or property to read.
      { code: 'factory()("node:fs");', filename: "src/build/discover.ts" },
    ],
    invalid: [
      {
        code: "const fs = await import(`node:fs`);",
        filename: "src/build/discover.ts",
        errors: [{ messageId: "noNodeFs", data: { specifier: "node:fs" } }],
      },
      {
        code: "const fs = require(`fs/promises`);",
        filename: "src/build/discover.ts",
        errors: [{ messageId: "noNodeFs", data: { specifier: "fs/promises" } }],
      },
      {
        code: 'const fs = process.getBuiltinModule("node:fs");',
        filename: "src/build/discover.ts",
        errors: [{ messageId: "noNodeFs", data: { specifier: "node:fs" } }],
      },
      {
        code: "const fs = process.getBuiltinModule(`fs`);",
        filename: "src/build/discover.ts",
        errors: [{ messageId: "noNodeFs", data: { specifier: "fs" } }],
      },
    ],
  },
)

const typescriptTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: "module" },
})

typescriptTester.run(
  "no-node-fs: TypeScript import-equals",
  noNodeFs as unknown as Rule.RuleModule,
  {
    valid: [
      { code: `import path = require("node:path");`, filename: "src/build/discover.ts" },
      {
        code: `namespace A { export const b = 1 } import x = A.b;`,
        filename: "src/build/discover.ts",
      },
    ],
    invalid: [
      {
        code: `import fs = require("node:fs");`,
        filename: "src/build/discover.ts",
        errors: [{ messageId: "noNodeFs", data: { specifier: "node:fs" } }],
      },
    ],
  },
)

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
