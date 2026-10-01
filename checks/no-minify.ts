/**
 * Nothing this organization ships may be minified: minified code is a Socket.dev supply-chain
 * alert, and 0 minification is permitted. Two layers, both fail-closed (see
 * {@link file://../scripts/check-no-minify.mjs}): a static check that no tsup config or
 * package.json script requests `minify*`, and an inspection of the real build output for
 * minified-looking code (very long lines). No allowlist, no configuration.
 *
 * A package with no build output directory ships nothing built, so it passes vacuously.
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
