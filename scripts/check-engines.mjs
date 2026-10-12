// Entry point for the `EngineMatrix` check (see checks/engine-matrix.ts). Prints one JSON envelope; never
// exits non-zero for a finding (policy decides).
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { judgeEngineMatrix } from "./engines/validate.mjs"

const cwd = process.cwd()
const manifestPath = path.join(cwd, "package.json")
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath).toString()) : {}
const dir = path.join(cwd, ".github", "workflows")
const workflows = existsSync(dir)
  ? readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => readFileSync(path.join(dir, name)).toString())
  : []
const report =
  manifest.private === true ? { state: "exempt" } : judgeEngineMatrix(manifest, workflows)
process.stdout.write(JSON.stringify({ ok: true, ...report }))
