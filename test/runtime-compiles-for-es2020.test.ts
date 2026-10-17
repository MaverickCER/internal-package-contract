import { readdirSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

// Every file in runtime/ is carried into packages as a managed copy and compiled with the package's own settings,
// and env-cap compiles for ES2020. A copy that uses a later API (`String.prototype.replaceAll`, `Array.prototype.at`)
// type-checks here but breaks that package's build, so the copies are checked against ES2020 too.
describe("runtime/ managed copies", () => {
  it("type-check for ES2020, the oldest target a package that carries them compiles for", () => {
    const files = readdirSync("runtime")
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
      .map((name) => path.join("runtime", name))
    const program = ts.createProgram(files, {
      target: ts.ScriptTarget.ES2020,
      lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["node"],
    })
    const problems = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
    expect(problems).toEqual([])
  })
})
