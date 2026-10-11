// Run by the `prepare` script on `npm install`: points git at internal-package-contract's hooks.
// It can never fail an install. `prepare` also runs when this package is installed from git by someone
// else, where internal-package-contract is not installed; then it does nothing.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

const cli = path.join("node_modules", "internal-package-contract", "bin", "contract.mjs")
if (existsSync(cli)) {
  spawnSync(process.execPath, [cli, "install-hooks"], { stdio: "inherit" })
}
