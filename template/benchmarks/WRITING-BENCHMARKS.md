# Writing benchmarks

This guide is for the person adding or changing a benchmark. It explains **what** to test, **how** to
test it, **why** each choice is made, and **how to document** the result so a platform engineer or CTO
can read it without knowing the code. Its companion, [READING-BENCHMARKS.md](READING-BENCHMARKS.md),
explains how to interpret what you produce.

The benchmarks exist to answer one question for the people who run this package in production:
**what does it cost me, in time and in money, and how does that grow as my workload grows?** The rest
of the repository makes the case for what the package gives you; the benchmarks are deliberately
honest about what it costs.

## The three views

Every suite measures the package from three angles, each building on the last.

1. **End-to-end: the total impact.** One operation done two ways, with empty or minimal functions
   plugged in: once with no package (the _baseline_) and once routed through the package. The
   difference is the package's own cost -- the floor it imposes on every operation. Keep both sides
   trivial on purpose: if you plug in real work, you are measuring that work.
2. **Functions: each part on its own.** Every function the end-to-end run uses (and every public
   function worth knowing about) is measured separately across the full size ladder, so we can see
   how each one scales and whether it behaves the way we say it does.
3. **Contribution: where the cost lives.** Each function says how often one end-to-end operation calls
   it (`inEndToEnd`). The report multiplies that by the function's measured cost and shows its share
   of the overhead, so effort goes to the function that actually matters.

## What to test

Use this checklist when you add a function or change an existing one. A function with no benchmark is
a function whose cost nobody can see.

- **Every public function** the package exports, and every internal function that runs on the hot
  path of the end-to-end operation.
- **The end-to-end operation** the package exists to perform, in its smallest realistic form.
- **Cold start**, if the package does work at import or startup (module evaluation, building
  registries, reading configuration). Cold start is paid by every process, every deploy and every
  serverless invocation that scales from zero.
- **Memory**, not just time: what the operation allocates and retains. The report records the heap
  delta of every sample.
- **Every variable that could change the cost.** This is the part that is easy to skip and the part
  that matters most. Walk through each of these for every function and decide, explicitly, whether it
  is _swept_ (the size axis), a _variant_ (measured separately), or _fixed_ (held constant on
  purpose, with the value stated):
  - **Input size** -- the size ladder below. Always swept.
  - **Input shape** -- flat vs deeply nested, many small items vs few large ones, wide vs narrow
    objects, strings vs numbers, sorted vs random vs adversarial order.
  - **State** -- empty vs populated, first call (cold) vs repeated call (warm), cache hit vs miss.
  - **Options and modes** -- every flag that changes the algorithm used.
  - **Outcome** -- the success path **and** the error path. Errors are often slower and often hit
    under load, exactly when slowness hurts most.
  - **Concurrency** -- one caller vs many at once, if the function keeps shared state or does async
    work.
  - **Environment** -- runtime and version, platform, available CPU and memory.
- **What you deliberately do not cover**, listed in `notCovered` with the reason. An honest gap is
  documentation; a silent gap is a trap.

## The size ladder

Every function is measured at **20, 40, 80, 160, 320, 640, 1280, 2560, 5120 and 10240** units of
`n`. `n` is whatever one suite declares as its workload unit (a record, a variable, a file, a call).

Ten doubling points are not arbitrary. Big-O is estimated by fitting a line through
`log(time)` against `log(size)`; its slope is the growth exponent. Three points cannot tell `O(n)`
from `O(n log n)` or `O(1)` from `O(log n)`. A ladder spanning more than two orders of magnitude, with
ten points, can. `typicalN` (default 640) marks the size the cost summary quotes -- choose the size a
real operation of this package typically handles, and say why in `workload.description`.

Never shorten the ladder for committed results. `--quick` exists for a smoke test and says so in its
output; do not commit what it produces.

## How to test

- **Separate setup from the measured work.** `setup(n)` builds the input and is not timed; `run(ctx)`
  is the only thing measured. Generating a 10,000-item array inside `run` measures the generator.
- **Return a value that depends on the work.** The engine keeps the returned value alive. A function
  whose result is thrown away can be optimized into nothing, and you will have benchmarked an empty
  loop.
- **Fresh state when the work changes its own input.** If `run` mutates what `setup` built (committing
  to a store, draining a queue), set `fresh: true` so each sample gets a new `setup`. Otherwise the
  second sample measures a different, usually easier, problem.
- **Deterministic input.** No `Math.random()`, no `Date.now()` in input generation. Generate from the
  index (`item i = { id: i, name: "item-" + i }`) so two runs measure the same thing. If you need
  pseudo-randomness, use a seeded generator and record the seed in the suite.
- **No real I/O.** A network call or disk read measures the network or the disk. Simulate it with a
  function that resolves from a prepared pool; keep the real code path (queues, deduplication, error
  handling) intact, because that is what the package contributes.
- **Import the package the way a consumer does.** Its built entry point, never a source path. The
  published `exports` map is part of the cost (and of the risk).
- **Let the engine handle fast operations.** Operations faster than about a millisecond are repeated
  back to back inside one sample and the result divided, because timers cannot resolve them. You
  do nothing; the report records the batch size.
- **Quiet machine.** Close heavy programs, plug in a laptop, and run on the same machine you compared
  against last time. Never compare across machines (see the reading guide).

## How to document a benchmark

`defineSuite` refuses a suite with missing or placeholder documentation, and `npm run benchmark:check`
runs that validation without measuring anything, so it can run in CI on every change. Every function
needs the following, written for a reader who does not know the code.

### `why` -- why we benchmark it

The reason this function earns a benchmark: where it runs, how often, and who feels it. Not what it
does -- why its cost matters.

> **Good:** "Runs once per getter call, on every request that reads fetched data, so its per-call cost
> is multiplied by the application's whole read traffic."
>
> **Bad:** "Tests the commit function."

### `poorPerformanceMeans` -- what slow would mean

Translate slowness into consequences for the people running the system: latency users notice, server
capacity, cloud spend, cold-start time, memory pressure.

> **Good:** "A slowdown adds directly to every response time and to compute cost per request; at
> 10,000 items a quadratic regression would turn a 50 ms commit into several seconds and exhaust
> request timeouts."
>
> **Bad:** "Performance would be worse."

### `expectedComplexity` and `complexityReason` -- the big-O and why

Pick the class you **expect from reading the code** before you run anything:

| Class                  | Notation       | Typical cause                                                               |
| ---------------------- | -------------- | --------------------------------------------------------------------------- |
| `constant`             | O(1)           | A lookup or a fixed amount of work regardless of size.                      |
| `logarithmic`          | O(log n)       | Binary search, balanced-tree operations.                                    |
| `linear`               | O(n)           | One pass over the input.                                                    |
| `linearithmic`         | O(n log n)     | Sorting, or a pass that does a log-cost operation per item.                 |
| `quadratic`            | O(n²)          | A pass inside a pass (nested loops, repeated scans, repeated array copies). |
| `exponential-or-worse` | O(n³) or worse | Anything faster-growing than quadratic.                                     |

The reason is one or two sentences that **name the mechanism**, so a reader can check it against the
code: "walks every newly arrived item once to freeze it" is a reason; "it is linear" is not. After the
run, the report compares the measured class with this one. **Agreement** is the goal; a **difference**
means the documentation or the code is wrong -- both are worth fixing. Neighbouring classes
(constant/logarithmic, linear/linearithmic) are reported as "close" because a bounded ladder cannot
reliably separate them.

### `variables` -- everything that could change the cost

One row per variable from the checklist above, each marked:

- `swept` -- it is the size axis.
- `variant` -- measured separately; describe each in `variants`.
- `fixed` -- held constant on purpose; give the `value`, so a reader knows what was and was not
  covered.

### `variants` -- measured alternatives

When a variable changes the algorithm (cache hit vs miss, flat vs nested, success vs error), measure
each as a named variant across the whole ladder. Each variant is its own row in the report and its own
chart in history, so a regression in one path cannot hide behind another.

### `notCovered` -- the honest gaps

Name what you chose not to measure and why ("concurrent callers: the function is synchronous and
keeps no shared state"). A reader should never wonder whether something was forgotten.

### `inEndToEnd` -- where it fits in the whole

State how often one end-to-end operation calls this function (`callsPerOperation`, a number or a
function of `n`) and describe the call. This is what lets section 3 of the report attribute the
overhead to the functions that cause it.

### The end-to-end block

`endToEnd.purpose` says what the comparison shows and why it matters to someone adopting the package.
`baseline.description` and `withPackage.description` state exactly what each side does, and must make
clear that both use empty or minimal functions. List the end-to-end `variables` the same way as for a
function.

## Reviewing a benchmark change

Before you open a pull request:

- [ ] `npm run benchmark:check` passes (the documentation is complete and not a placeholder).
- [ ] A **full** `npm run benchmark` ran on a quiet machine and no function reports **differs** that
      you cannot explain.
- [ ] Every new public function has a benchmark, a `why`, a `poorPerformanceMeans`, a big-O with a
      mechanism, and a variables table.
- [ ] Every variable on the checklist is `swept`, a `variant`, `fixed` with a value, or in
      `notCovered` with a reason.
- [ ] The end-to-end baseline still uses empty or minimal functions.
- [ ] You did not commit a `--quick` result.

## Commands

```sh
npm run benchmark          # full ladder -> benchmarks/results.json and benchmarks/BENCHMARKS.md
npm run benchmark -- --quick        # smoke test; never commit its output
npm run benchmark -- --only package-name,end-to-end   # run a subset while developing
npm run benchmark:check    # validate documentation and shape; measures nothing
```
