/**
 * `NoMinify`: nothing the package ships is minified, and nothing asks for minification.
 *
 * Reads: every `tsup.config.*` and every package.json script, for a `minify*` option or flag. Also
 * every `.js`, `.cjs` and `.mjs` under `dist/`, for lines that look minified. Both through
 * `scripts/check-no-minify.mjs`. Minified code is a Socket.dev supply-chain alert.
 *
 * Fails on any request for minification and on any shipped file that looks minified. Never warns.
 * Passes when `dist/` does not exist and nothing is requested: nothing built ships.
 *
 * Exceptions: none, and no configuration. Remove the `minify*` option and rebuild.
 *
 * Runs in the consumer `contract` job and in both git hooks. It runs after `Build`. IPC's own
 * self-contract leaves it out: this package has no `dist/`.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-no-minify.mjs")

interface ConfigFinding {
  readonly file: string
  readonly line: number
  readonly text: string
}
interface OutputFinding {
  readonly file: string
  readonly reason: string
}
interface NoMinifyReport {
  readonly ok: boolean
  readonly dirExists?: boolean
  readonly config?: readonly ConfigFinding[]
  readonly output?: readonly OutputFinding[]
}

/** @returns the `NoMinify` check, scanning `dir` (default `dist`). */
export function noMinify(dir = "dist"): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath, dir],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<NoMinifyReport>(result, "check-no-minify", "No minify:")
      if (!envelope.ok) return envelope.result

      const report = envelope.value
      const config = report.config ?? []
      const output = report.output ?? []
      if (config.length === 0 && output.length === 0) {
        return {
          outcome: "pass",
          rationale:
            report.dirExists === true
              ? `No minification requested or found in "${dir}".`
              : `No minification requested; "${dir}" does not exist, so nothing built is shipped.`,
        }
      }

      return {
        outcome: "fail",
        rationale: [
          "Minified code must not ship (Socket.dev flags it; 0 minification is permitted). Remove every `minify*` option and rebuild:",
          ...config.map(
            (f) =>
              `- ${f.file}${f.line > 0 ? `:${String(f.line)}` : ""} requests minification: ${f.text}`,
          ),
          ...output.map((f) => `- ${dir}/${f.file} looks minified: ${f.reason}`),
        ].join("\n"),
      }
    },
  }
}
