// {{name}} benchmark suite. Read WRITING-BENCHMARKS.md first: it explains what to measure, how, and
// how to document it. `defineSuite` REFUSES a suite whose documentation is missing or a placeholder.
//
// Run:    npm run benchmark          (full ladder, writes results.json and BENCHMARKS.md)
//         npm run benchmark -- --quick     (smoke test, never commit its output)
//         npm run benchmark:check    (validates the documentation only; fast, runs in CI)

import { defineSuite } from "internal-package-contract/benchmark"
// Import the package the way a consumer does -- its built entry point -- never a source path.
import { packageName } from "../dist/index.js"

export default defineSuite({
  package: { name: "{{name}}", bundleFiles: ["dist/index.js"] },

  // What one unit of `n` is. Every size on the ladder (20 ... 10240) is a count of this unit.
  workload: {
    unit: "call",
    description: "One call of the package's entry function inside a single operation.",
    typicalN: 640,
  },

  // AREA 1 -- the total impact of adopting the package, measured with EMPTY or MINIMAL functions on
  // both sides so the difference is the package's own cost, not your application's.
  endToEnd: {
    purpose:
      "Shows what a team pays, per operation, simply for routing work through the package instead of calling a bare function. This is the floor of the package's cost: real applications add their own work on top of it.",
    baseline: {
      description: "A loop of n calls to an empty function, with no package involved.",
      run: (n) => {
        let total = 0
        for (let i = 0; i < n; i += 1) total += "x".length
        return total
      },
      setup: (n) => n,
    },
    withPackage: {
      description: "The same loop of n calls, each routed through the package's entry function.",
      // `call` is the function under test; `input(n)` builds its argument list. The engine invokes
      // `call(...input(n))`. (Use `setup`/`run` instead when you need to build state first.)
      call: (n) => {
        let total = 0
        for (let i = 0; i < n; i += 1) total += packageName().length
        return total
      },
      input: (n) => [n],
    },
    variables: [
      {
        name: "calls per operation",
        how: "swept",
        description: "The tier axis: how many package calls one operation makes.",
      },
      {
        name: "runtime",
        how: "fixed",
        value: "node",
        description: "Measured on Node only; other runtimes are not covered.",
      },
    ],
  },

  // AREA 2 -- every function the end-to-end run uses, measured on its own.
  functions: [
    {
      id: "package-name",
      name: "packageName",
      why: "It is the package's entry point and runs on every operation, so its per-call cost is multiplied by every request the package sees.",
      poorPerformanceMeans:
        "Every request through the package pays the slowdown, and it multiplies with traffic: a regression here is a regression everywhere.",
      expectedComplexity: "linear",
      complexityReason:
        "One operation makes n calls and each call does a constant amount of work, so the total grows in direct proportion to n.",
      variables: [
        { name: "calls per operation", how: "swept", description: "The tier axis." },
        {
          name: "arguments",
          how: "fixed",
          value: "none",
          description: "The function takes no arguments, so there is no payload-shape variable.",
        },
      ],
      notCovered: [
        {
          name: "concurrent callers",
          reason:
            "The function is synchronous and keeps no shared state, so concurrency cannot change its cost.",
        },
      ],
      // How the end-to-end run uses this function, so section 3 can attribute the overhead to it.
      inEndToEnd: { callsPerOperation: (n) => n, description: "Called once per unit of n." },
      call: (n) => {
        let total = 0
        for (let i = 0; i < n; i += 1) total += packageName().length
        return total
      },
      input: (n) => [n],
    },
  ],
})
