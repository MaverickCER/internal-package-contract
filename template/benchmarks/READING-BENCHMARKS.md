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
   minimal functions on both sides, at ten sizes. The difference is the package's total impact, with
   nothing of your own application mixed in.
3. **Function by function.** Every function measured alone across the same ten sizes, with: why it is
   benchmarked, what poor performance would mean, its documented big-O and the reason for it, every
   variable that could change its cost, and what was deliberately not covered.
4. **What makes up the overhead.** Each function's cost, multiplied by how often one operation calls
   it, as a share of the end-to-end overhead -- where the cost actually lives.

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
the log of size across all ten sizes; the slope is the **growth exponent**, snapped to the nearest
class:

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
  than a 15% shift in a timing, and it survives machine differences, because it is a ratio between
  sizes on the same run.
- **Relative cost between functions.** Which function dominates the overhead is true on any machine,
  even when the absolute times are not.
- **Order of magnitude.** Microseconds, milliseconds or seconds per operation: that distinction is
  stable enough to plan with.

## Noise

Even on a quiet machine, repeated runs differ. Very fast operations (microseconds and below) are the
noisiest in relative terms; the engine batches them and reports the per-operation value, but a 30-40%
swing between runs on those is ordinary. Slow operations are steadier. Read the median and p95
together, and trust a trend over a single run. The pull-request summary highlights movements beyond a
per-benchmark threshold; highlights are prompts to look, never automatic failures.

## How the documentation is done

Documentation is part of the benchmark definition, not an afterthought, and the suite will not load
without it. For every function the report prints, in this order:

1. **Why we benchmark it** -- where it runs, how often, and who feels it.
2. **What poor performance would mean** -- the consequence in latency, capacity and spend.
3. **Expected growth** -- the big-O and the mechanism that causes it.
4. **Variables that could change its cost** -- each one swept, measured as a variant, or fixed at a
   stated value.
5. **Deliberately not covered** -- the honest gaps, with reasons.
6. **The measurements** -- ten sizes, median, p95, CPU, memory, throughput, and the measured class next
   to the documented one.

If a section reads as vague, that is a documentation bug: open an issue or fix it.

## History, pull requests and the history page

When a pull request touches benchmarked code, CI re-runs the suite and posts a summary: the end-to-end
change first, then any function whose growth class shifted, then ordinary timing movements beyond
their thresholds. Merged results are appended to a committed history file, and a generated history
page charts every function across runs. These exist to catch regressions early; none of them blocks a
merge on its own.

## Glossary

- **Operation** -- one unit of the work the package performs, as defined by the suite.
- **Size / `n`** -- how much that operation processes (records, calls, files).
- **Baseline** -- the same operation with no package, using an empty or minimal function.
- **Overhead / added** -- with-package time minus baseline time: the package's own cost.
- **Median / p95** -- the middle sample, and the value 95% of samples beat.
- **Heap Δ** -- memory the operation left allocated.
- **Batch** -- the number of back-to-back repetitions inside one sample for very fast operations.
- **Cold start** -- the cost of loading and initializing the package in a fresh process.
