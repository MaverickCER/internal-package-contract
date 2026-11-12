# Exceptions

A finding is excused only by a committed record that the owning check reads back every run. The run's exit
code is pass or fail; three checks warn by design and never fail (`GitHooks`, `EnvContract`, and `CodeRabbit`
except on broken evidence). Nothing is allowed by a comment, a flag or a dismissed alert alone
(`checks/exception-record.ts`; `test/exception-record.test.ts`).

Three kinds of thing end up in a registry:

| Kind                                            | Example                                                                    | Registry                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A finding someone decided to live with          | a Socket alert on a dependency the package cannot exist without            | `socket.json`, `security-deps.json`, `dist-urls.json`, `coderabbit.json`, `code-scanning.json` |
| A tool that cannot see what it was built to see | a Stryker mutant the suite provably kills but Stryker reports as surviving | `mutation.json`                                                                                |
| A check that **could not run here**             | CodeRabbit has no CLI in CI; a link host rate-limits the link checker      | `environment.json`                                                                             |

## The record

Every record is an object with an `id` (derived from what it covers, so it survives unrelated edits and goes
stale when the covered code changes), a `version`, and a `justification`. A `version: 2` record, the shape
every new record takes, also carries the elements that make an exception auditable:

| Field           | Answers                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ruleBroken`    | Which rule of the standard is being broken?                                                                                       |
| `attempted`     | What was tried first, and why did it not work?                                                                                    |
| `constraint`    | What technical constraint forced the exception?                                                                                   |
| `whyPreferable` | Why is the chosen outcome better than the alternatives?                                                                           |
| `residualRisk`  | What risk remains, and who carries it?                                                                                            |
| `revisitWhen`   | Under what condition must this record be reopened?                                                                                |
| `expires`       | Required key: a `YYYY-MM-DD` date after which the record no longer counts, or `""` for none. Leaving the key out is a load error. |

A blank field is an incomplete record: the check that owns the registry fails and names what is missing
(`test/environment-exceptions.test.ts`; `test/security-socket.test.ts`). A freshly scaffolded stub is all blanks
on purpose. The legacy `version: 1` shape (only `justification`) is still read, so a registry can migrate record
by record; `internal-package-contract exceptions` counts what is left. Two limits: `expires: ""` is accepted, so
a record can be permanent, and the fields are required to be non-blank, not judged for quality.

The security-family registries add `alternatives`, `remediation`, `method` and `exceptionType`:

- `exceptionType`: `validated-false-positive`, `accepted-risk`, `compensating-control`, `tooling-limitation`,
  `scheduled-remediation`, `platform-or-vendor-constraint`, `required-for-package-to-exist`,
  `dev-only-not-shipped`. Each registry accepts the subset that can be true for it; `SecuritySocket` never
  accepts a waiver for a critical or high alert (`test/security-socket.test.ts`).
- `method`: `mechanical-reverification` (a tool re-run confirms it; the only method that can back
  `validated-false-positive`), `independent-human-review`, or `policy-rule` (no individual reviewed it: a
  standing rule of the standard decided, as when `CodeScanning` rejects an alert in test code by location).

An exception is not a place to park unfinished work. If the honest `revisitWhen` is "when someone gets round to
it", fix the thing; `scheduled-remediation` is for a fix that is planned and tracked, with an `expires` date.

## The registries

All live under `.repo-contract/exceptions/` and are committed. The header comment of each check documents its
record shape with a complete example.

| File                        | Check                 | Id                                            | Covers                                                |
| --------------------------- | --------------------- | --------------------------------------------- | ----------------------------------------------------- |
| `socket.json`               | `SecuritySocket`      | `socket:<package>@<version>:<alert type>`     | an alert on the package's own Socket page             |
| `security-deps.json`        | `SecurityDeps`        | `security-deps:<package>@<range>`             | an `npm audit` advisory                               |
| `dist-urls.json`            | `DistNoUrls`          | `dist-url:<url>`                              | a URL in a shipped file                               |
| `code-scanning.json`        | `CodeScanning`        | `code-scanning:<rule>@<path>`                 | a code-scanning alert in development-only code        |
| `coderabbit.json`           | `CodeRabbit`          | `coderabbit:<file>:<severity>:<hash>`         | a CodeRabbit finding                                  |
| `mutation.json`             | `Mutation`            | `mutation:<file>:<mutator>:<hash>`            | one mutant, matched by its source text                |
| `environment.json`          | any                   | `environment:<Check>:<code>`                  | a check that could not run (below)                    |
| `benchmark-complexity.json` | `BenchmarkComplexity` | `benchmark-complexity:<group>:<function>`     | a measured growth class worse than the documented one |
| `managed-files.json`        | `ManagedFiles`        | `managed-file:<path>`                         | a managed consumer file that deliberately differs     |
| `suppressions.json`         | `Suppressions`        | `suppression:<domain>:<rule>:<file>:<anchor>` | a blanket suppression comment with a reason           |
| `skipped-tests.json`        | `Tests`               | `skipped-test:<file>`                         | a test file that skips in the contract job            |

Staleness is checked both ways: a finding with no complete record fails, and a record whose finding is gone
fails as stale (`test/security-socket.test.ts`; `test/dist-no-urls.test.ts`; `checks/mutation.ts`). Two
limits. `skipped-tests.json`: a suite that skips only on Windows has no skip on Linux, so an unused record there
is not an error. `mutation.json` under a narrowed or sharded run: a record for a mutant in a file that run did
not mutate is not called stale, since only the full report can say so.

A `// Stryker disable` comment with a reason passes `Suppressions`, and the mutants it hides are left out of the
score: counted in the `Mutation` rationale, not excused by a record. The bundled Stryker baseline also sets
`ignoreStatic: true`, so static mutants are never counted.

### When a check cannot run

Some results are not findings: the check never got to look. Chrome is missing, the origin is not on GitHub, a
link host throttles the link checker. These never pass silently, with one exception: `SecuritySocket` passes
for a private package, since nothing is published to score. The check records the degradation (it appears in
`reports/contract/report.json` and in the step summary with its own class) and:

- **locally** it is a `warn`, so a laptop without Chrome can still run the rest;
- **in CI** (`--strict`, the default when `CI` or `GITHUB_ACTIONS` is set) it **fails**, unless
  `environment.json` holds a complete record `environment:<Check>:<code>` saying why that is acceptable there
  (`checks/environment-exceptions.ts`; `scripts/contract-run.mjs`).

The codes in use are `Accessibility:no-chrome`, `Accessibility:no-site`, `BranchProtection:gh-unavailable`,
`Commits:no-base`, `Commits:pre-adoption`, `CodeRabbit:not-applicable` (CI), `CodeRabbit:unavailable` (no CLI),
`PackedConsumer:install` (the packed tarball could not be installed into a scratch project),
`SecuritySocket:no-key` (no Socket API token; `init` writes this record with a 90-day expiry),
`CodeScanning:not-enabled` and `CodeScanning:no-remote`, and `DocsLinks:<url>` for each external link that could
not be reached. The warn names the exact id to add. This list is prose: no test checks that every `degraded()`
call site uses a code listed here.

## Who approves, and how

Whoever approves the pull request approves the record: registries are ordinary files under `CODEOWNERS`. No
ruleset requires a code-owner review or an approving review, so the review is whatever the pull request gets.
There is no side channel: a dismissed GitHub alert, a `// eslint-disable`, a `/* v8 ignore */` or a
`// Stryker disable` with no reason is itself a finding (`Suppressions`).

## What is in force

```sh
npx internal-package-contract exceptions          # per registry: count, by type, legacy, expired, incomplete
npx internal-package-contract exceptions --json
```

The same inventory is attached to every contract run's `report.json` and step summary
(`test/exceptions-inventory-exact.test.ts`).
