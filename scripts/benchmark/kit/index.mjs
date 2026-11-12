// Public entry of the shared benchmark kit: `import { defineSuite, ... } from "internal-package-contract/benchmark"`.
// Everything a suite file or a package's own benchmark script needs is re-exported here, so no file under
// kit/ is imported by path.
export {
  COMPLEXITY_NOTATION,
  SuiteDefinitionError,
  defineSuite,
  expectationOf,
  groupName,
  parseGroup,
} from "./define.mjs"
export { QUICK_TIERS, STANDARD_TIERS, tierName, validateTiers } from "./tiers.mjs"
export {
  computeDurationStats,
  computePairedStats,
  percentile,
  sample,
  samplePaired,
  snapshotMemory,
  timed,
} from "./measure.mjs"
export { DEFAULT_RATES, estimateCost, formatUsd } from "./cost-model.mjs"
export { RESULTS_SCHEMA_VERSION, agreement, analyze, runSuite } from "./run.mjs"
export { formatBytes, formatMs, renderReport } from "./report.mjs"
export { validateResults } from "./results-contract.mjs"
