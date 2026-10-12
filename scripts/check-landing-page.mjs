// Entry point for the `LandingPage` check (see checks/landing-page.ts). Prints one JSON envelope; never
// exits non-zero for a finding (policy decides).
import { existsSync } from "node:fs"
import path from "node:path"
import { run } from "./site/render-site.mjs"

const cwd = process.cwd()
if (!existsSync(path.join(cwd, "docs", "site.json"))) {
  process.stdout.write(JSON.stringify({ ok: true, state: "absent" }))
} else {
  const messages = []
  const code = await run(["--check"], cwd, {
    out: () => {},
    err: (text) => messages.push(text.trim()),
  })
  process.stdout.write(
    JSON.stringify(
      code === 0
        ? { ok: true, state: "current" }
        : { ok: true, state: "problem", message: messages.join("\n") },
    ),
  )
}
