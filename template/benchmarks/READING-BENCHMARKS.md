# Reading the benchmarks

This guide is for the person **reading** `BENCHMARKS.md`: a platform engineer deciding whether to run
this package, a CTO estimating what it adds to the infrastructure bill, or a maintainer checking a
change. It explains why the benchmarks exist, how to read each number, and -- just as important --
what you must **not** do with them.

Its companion, [WRITING-BENCHMARKS.md](WRITING-BENCHMARKS.md), explains how benchmarks are written and
documented.

## Why we benchmark

Every dependency has a price. Most of it is invisible until it is large: a few milliseconds added to
every request, a CPU core that is busier than it needs to be, a function that is fast on ten items and
unusable on ten thousand, a cold start that grows with every module. By then it is expensive to
remove.

The benchmarks make that price visible **before** you adopt the package and **every time** it changes.
They lean toward costs on purpose. The rest of the repository explains the benefits; this report tells
you what you are paying for them, in time and in money, and how the bill grows with your workload.

## What is in the report

`BENCHMARKS.md` has four parts, in the order a decision-maker needs them:

1. **What adopting this package costs.** The headline: added latency, CPU and memory per operation at
   a typical workload and at the largest tested size, an estimated compute cost per million
   operations, and the code size every process must load. If you read nothing else, read this.
2. **End-to-end.** The same operation done with no package and through the package, using empty or
   minimal functions on both sides, at every size of the ladder (ten doubling sizes by default; the
   report's environment section lists the sizes actually used). The difference is the package's total impact, with
   nothing of your own application mixed in.
3. **Function by function.** Every function measured alone across the same sizes, with: why it is
   benchmarked, what poor performance would mean, its documented big-O and the reason for it, every
   variable that could change its cost, and what was deliberately not covered.
4. **What makes up one operation.** Each function's cost, multiplied by how often one operation calls
   it, with nested calls counted once, as a share of the whole operation -- where the cost actually
   lives.

## How to read a table

| Column          | Meaning                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| size (`n`)      | The workload size for that row. The unit (record, call, file...) is stated at the top of the section.                    |
| Median          | The middle sample. Robust against the occasional slow outlier; the number to quote.                                      |
| p95             | 95% of samples were this fast or faster. The gap between median and p95 is the variability you should plan for.          |
| CPU (median)    | CPU time actually spent. Can exceed wall time slightly because of background compilation and garbage collection threads. |
| Heap Δ          | Memory the operation left allocated (can be negative when garbage was collected during the sample).                      |
| Ops/s           | Operations per second on one core at that size: the throughput ceiling of the operation alone.                           |
| Added / Added % | End-to-end only: time added over the baseline, absolute and as a percentage.                                             |

## Big-O and the growth exponent

Big-O describes how cost grows as size grows -- more useful than any single timing, because it tells
you what happens at a size you did not test. The report fits a line through the log of time against
the log of size across the **largest** sizes (the top five of a long ladder: a real cost is a fixed
per-call overhead plus work that grows, and the overhead hides the growth at small sizes); the slope
is the **growth exponent**, snapped to the nearest class. The fit's R² is reported next to it, and when
the cost moves but does not follow a power law (a step, a cache cliff) no class is claimed at all:

| Exponent (about) | Class          | What doubling the size does to the time |
| ---------------- | -------------- | --------------------------------------- |
| 0                | O(1)           | Nothing.                                |
| 0.3              | O(log n)       | Adds a small constant.                  |
| 1                | O(n)           | Doubles it.                             |
| 1.2              | O(n log n)     | A little more than doubles it.          |
| 2                | O(n²)          | Quadruples it. Dangerous at scale.      |
| 3 or more        | O(n³) or worse | Eight times or more. Unusable at scale. |

Each function shows its **documented** class next to its **measured** class with an agreement label:

- ✅ **matches** -- the code behaves as documented.
- 🟡 **close** -- neighbouring classes. Constant vs logarithmic and linear vs linearithmic cannot be
  reliably separated on a bounded ladder; treat it as a match unless the exponent has moved.
- ⚠️ **differs** -- two or more classes apart. Either the documentation or the code is wrong. This is
  the most useful line in the report.
- ❔ **not enough data** -- fewer than two usable sizes; something failed.

## The dollar figures

Time becomes money through two bracketing price shapes, because platforms bill differently:

- **Low:** CPU-priced compute (a container or VM billed per vCPU-hour) -- you pay for CPU seconds.
- **High:** duration-and-memory-priced functions (billed per GB-second) -- you pay for wall seconds
  times the memory the platform reserves, never less than its minimum.

The rates are rounded published list prices and are **assumptions**; they drift with time and region.
Override them in `benchmark.config.json` → `costRates` to match your platform and negotiated pricing.
Treat the result as an order-of-magnitude comparison ("fractions of a cent per million operations" vs
"dollars per million operations"), not a quote.

## Results are not comparable between runs

This is the rule that matters most. **A benchmark number is a measurement of one run on one machine at
one moment.** It is not a property of the package.

- Do **not** compare numbers from different machines, operating systems, Node versions, or runners. A
  laptop and a CI runner differ by large factors in both directions.
- Do **not** compare today's number with last month's if anything about the machine or load changed.
  Background work, thermal throttling, other tenants on a shared runner and power settings all move
  timings by 10-40%.
- Do **not** compare one package's numbers with another package's. The workloads differ; the
  comparison means nothing.
- Do **not** treat any single number as a promise. It is not a guarantee, a service-level agreement or
  a competitive claim.

What the numbers **are** good for:

- **Change over time on comparable hardware.** The same suite on the same kind of machine before and
  after a change shows whether the change made the package slower. Look for movement larger than the
  run-to-run noise.
- **Shape, not just level.** A change in growth class (O(n) becoming O(n²)) is a much bigger signal
  than a 15% shift in a timing, and it is far less sensitive to the machine than a time is, because it
  is a ratio between sizes on the same run. It still assumes the same sizes, workload and runtime.
- **Relative cost between functions.** Which function dominates the overhead is usually the same on
  any machine, even when the absolute times are not.
- **Order of magnitude.** Microseconds, milliseconds or seconds per operation: that distinction is
  stable enough to plan with.

## What the numbers do not prove

- **A complexity class is empirical.** It describes how measured cost grew across the sizes that were
  tested. It is not a proof of asymptotic complexity, and it can be wrong when the tested range is
  narrow or a fixed cost dominates.
- **R² is fit quality, not confidence.** It says how closely the measurements follow the fitted
  power law. A high R² does not show the class is right, and a low one means no class is reported.
- **The overhead is a difference.** `end-to-end:overhead` is not measured; it is the with-package
  time minus the baseline time at each size, never below zero. A difference of two noisy medians is
  noisier than either, so the history page shows it for reading only and gives it no complexity class,
  and the pull-request summary does not report a class shift for it. Read the baseline and with-package
  groups, and the "What the package adds" table, instead.
- **A relative cost is still a measurement.** Dividing by the baseline removes much of the machine,
  not all of it: compilation, garbage collection and contention on the runner still move it. Below the
  timer-noise floor the percentage is not shown.
- **One run per commit is not a repeat.** The history holds one measurement for each recorded commit.
  A trend is more convincing than a point; a single point moving is ordinary noise.

## Noise

Even on a quiet machine, repeated runs differ. Very fast operations (microseconds and below) are the
noisiest in relative terms; the engine batches them and reports the per-operation value, but a 30-40%
swing between runs on those is ordinary. Slow operations are steadier. Read the median and p95
together, and trust a trend over a single run. The pull-request summary shows the change against the last
run, but never judges it: a raw comparison is between two runs on different machines. What can fail a pull request is limited to growth classes and
baseline-relative ratios, which are far less sensitive to the machine than a raw time: see "History, pull
requests and the history page".

## How the documentation is done

Documentation is part of the benchmark definition, not an afterthought, and the suite will not load
without it. For every function the report prints, in this order:

1. **Why we benchmark it** -- where it runs, how often, and who feels it.
2. **What poor performance would mean** -- the consequence in latency, capacity and spend.
3. **Expected growth** -- the big-O and the mechanism that causes it.
4. **Variables that could change its cost** -- each one swept, measured as a variant, or fixed at a
   stated value.
5. **Deliberately not covered** -- the honest gaps, with reasons.
6. **The measurements** -- every size, median, p95, CPU, memory, throughput, and the measured class next
   to the documented one.

If a section reads as vague, that is a documentation bug: open an issue or fix it.

## History, pull requests and the history page

When a pull request touches benchmarked code, CI re-runs the suite and posts a summary: the end-to-end
change first, then any function whose growth class shifted, then ordinary timing movements beyond
their thresholds. Three gates can fail the run. None of them compares a raw time with another run's, because
two runs are on different machines. Two compare growth classes, which describe the shape of the curve and
not the speed of the machine: the measured class against the documented big-O (a function whose class
**differs** fails), and against the class at the last release (a function whose class has gotten **worse**
fails, unless `.repo-contract/exceptions/benchmark-complexity.json` records a person's acceptance of it).
The third is a ratio: the package's overhead _relative to its own baseline_, measured in the same run,
growing past an allowance (50% for millisecond-scale work, 70% for microsecond-scale work, which is
noisier) against both the last run on main and the last release. A function whose big-O could not be
determined (too few sizes, or no difference between them) is a **warning**: nothing is known to be wrong, but
nothing is checked. Raw time against another run is shown, never judged.

After a merge, a job measures the merge commit and records it -- the results file and a history entry
naming the commit, pull request and version -- through its own small pull request. Each entry also keeps
how noisy that run was (standard deviation, p95 and iteration count for every size) and the processor it
ran on, so a reader can judge later whether a change is larger than the run's own spread. A generated
history page opens with why the benchmarks exist and what they do and do not show, then charts every
function across runs, with every figure also available as a table, and shows the baseline, the
with-package time and the difference side by side.

## Glossary

- **Operation** -- one unit of the work the package performs, as defined by the suite.
- **Size / `n`** -- how much that operation processes (records, calls, files).
- **Baseline** -- the same operation with no package, using an empty or minimal function.
- **Overhead / added** -- with-package time minus baseline time: the package's own cost. Derived from the
  two measured groups, never below zero, and not itself classified.
- **Median / p95** -- the middle sample, and the value 95% of samples beat.
- **Heap Δ** -- memory the operation left allocated.
- **Batch** -- the number of back-to-back repetitions inside one sample for very fast operations.
- **Cold start** -- the cost of loading and initializing the package in a fresh process.
