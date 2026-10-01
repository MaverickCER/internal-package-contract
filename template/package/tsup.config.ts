import { defineConfig } from "tsup"

// The bundle ships UNMINIFIED -- never add any `minify*` option here: minified code is a Socket.dev
// supply-chain alert and the NoMinify check fails the contract on it. `dts: false` because
// declarations (with working declaration maps) are emitted by `tsc -p tsconfig.build.json` and
// shimmed into place by scripts/emit-dts-shims.mjs.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  platform: "node",
  target: "node20",
  dts: false,
  sourcemap: true,
  treeshake: true,
})
