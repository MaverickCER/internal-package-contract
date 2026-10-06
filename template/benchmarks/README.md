# Benchmarks

This folder is the performance and cost record of the package: what adopting it costs in time and
money, how each function scales, and where the cost comes from. It is built entirely by
[`internal-package-contract`](https://github.com/MaverickCER/internal-package-contract): the package
supplies **what to run** (an input), the contract **stresses it through a ladder of doubling sizes (ten by default), measures it, checks
the big-O and prices it**, and writes a **report** and a machine-readable **result** (the output).
Nothing in this folder implements timing, statistics or reporting.

## Read first

| File                                           | For whom     | What it is                                                                               |
| ---------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| [BENCHMARKS.md](BENCHMARKS.md)                 | Everyone     | The generated report: cost at a glance, end-to-end, per function, attribution.           |
| [READING-BENCHMARKS.md](READING-BENCHMARKS.md) | Readers      | Why we benchmark, how to read the numbers, and why they are not comparable between runs. |
| [WRITING-BENCHMARKS.md](WRITING-BENCHMARKS.md) | Contributors | What to test, how, why, and how to document it.                                          |
| [suite.mjs](suite.mjs)                         | Contributors | The input: what this package runs.                                                       |
| `results.json`                                 | Tools        | The output: every measurement and analysis, in a documented shape.                       |

The history page on the project website and the pull-request summaries link back here.

## Commands

```sh
npm run benchmark                   # full ladder -> results.json + BENCHMARKS.md
npm run benchmark -- --quick        # smoke test; never commit its output
npm run benchmark -- --only <id>    # run a subset while developing
npm run benchmark:check             # validate the suite's documentation; measures nothing
```

## The input: `suite.mjs`

A suite is plain data plus the functions to run. Import the package's real functions and describe
the arguments to give them at size `n`; the contract does the rest.

```js
import { defineSuite } from "internal-package-contract/benchmark"
import { parse, validate } from "../dist/index.js"

export default defineSuite({
  package: { name: "my-package", bundleFiles: ["dist/index.js"] },
  workload: { unit: "record", description: "One record in the collection.", typicalN: 640 },

  endToEnd: {
    purpose: "What routing one operation through the package adds over a bare function.",
    baseline: { description: "Empty function, no package.", call: (n) => n, input: (n) => [n] },
    withPackage: {
      description: "The same work through the package.",
      call: parse,
      input: (n) => [makeInput(n)],
    },
    variables: [{ name: "records", how: "swept", description: "The tier axis." }],
  },

  functions: [
    {
      id: "validate",
      name: "validate",
      why: "...",
      poorPerformanceMeans: "...",
      expectedComplexity: "linear",
      complexityReason: "...",
      variables: [{ name: "records", how: "swept", description: "The tier axis." }],
      call: validate, // the imported function under test
      input: (n) => [makeInput(n)], // its arguments at size n  ->  validate(...input(n))
      inEndToEnd: { callsPerOperation: 1, description: "Once per operation." },
    },
  ],
})
```

| Field                                                                   | Required | Meaning                                                                                       |
| ----------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `package.name`, `package.bundleFiles`                                   | yes / no | The package, and the shipped files whose size is reported.                                    |
| `workload.unit`, `workload.description`, `workload.typicalN`            | yes      | What one unit of `n` is, and the size the cost summary quotes (one of the tiers).             |
| `tiers`                                                                 | no       | The size ladder; defaults to `20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240`.            |
| `endToEnd.purpose`, `.baseline`, `.withPackage`, `.variables`           | yes      | The total-impact comparison with empty or minimal functions on both sides.                    |
| `functions[]`                                                           | yes      | One entry per function. Each is documented (below) and runnable.                              |
| `call` + `input(n, variantOptions)`                                     | one form | The function and its arguments at size `n`. Or use `setup(n)` + `run(ctx)` for stateful work. |
| `fresh`                                                                 | no       | Build new state for every sample (for work that consumes its own input).                      |
| `variants[]`                                                            | no       | Named alternatives (cache hit/miss, input shapes), each measured over the whole ladder.       |
| `tiers` + `tiersReason` (per function)                                  | no       | A shorter ladder for a function that cannot take the largest sizes, with the reason.          |
| `sampling`                                                              | no       | Override warmup/iteration counts for a very slow function.                                    |
| `why`, `poorPerformanceMeans`, `expectedComplexity`, `complexityReason` | yes      | The documentation. `defineSuite` rejects missing or placeholder text.                         |
| `variables[]`, `notCovered[]`                                           | yes / no | Every variable that could change the cost (swept / variant / fixed) and honest gaps.          |
| `inEndToEnd`                                                            | no       | How often one end-to-end operation calls the function, for the attribution section.           |

`expectedComplexity` is one of `constant`, `logarithmic`, `linear`, `linearithmic`, `quadratic`,
`cubic-or-worse`. Return a value that depends on the work (the contract keeps it alive so
nothing is optimized away); return `timed(ms)` only when an operation is timed elsewhere, such as a
child process.

## The output: `results.json`

`results.json` has three parts. The shape is fixed (`schemaVersion` 3) and checked on every run by
`validateResults`, which `internal-package-contract/benchmark` also exports.

```text
metadata   package, workload, tiers, environment (CPU, cores, memory, Node), git, bundleSizes,
           costRates, timing, generatedBy
results    one entry per measured group: "end-to-end:baseline", "end-to-end:with-package",
           "end-to-end:overhead", "fn:<id>", "fn:<id>@<variant>"
             tiers.n<size> = { id, status, inputs: { <unit>: size },
                               durationMs{min,median,p95,max,stdDev,iterations},
                               cpuMs{...}, heapDeltaBytes, opsPerSecond, configuration }
analysis   complexity      measured class, exponent and notation per group, with the documented
                           class and an agreement of matches / close / differs
           endToEnd        per size: baseline, with package, added time, added CPU, added memory,
                           estimated cost per million operations
           contribution    per function: calls per operation, estimated and exclusive time, share of the whole operation
           cost            the typical and largest sizes used for the headline numbers
```

Because results are not comparable between machines or runs, history and pull-request summaries look at
**change over time on comparable hardware** and at **changes in growth class**, never at one absolute
number. See [READING-BENCHMARKS.md](READING-BENCHMARKS.md).
