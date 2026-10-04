# Exceptions

The contract is a standard, not a suggestion: every check either passes or fails. Where a package has
a good reason to break a rule anyway, the reason is written down **as data** -- a record in a
registry that is committed, reviewed in the pull request that adds it, and read back by the check
every run. Nothing is allowed by a comment, a flag or a dismissed alert alone.

Three kinds of thing end up in a registry:

| Kind                                            | Example                                                                    | Registry                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A finding someone decided to live with          | a Socket alert on a dependency the package cannot exist without            | `socket.json`, `security-deps.json`, `dist-urls.json`, `coderabbit.json`, `code-scanning.json` |
| A tool that cannot see what it was built to see | a Stryker mutant the suite provably kills but Stryker reports as surviving | `mutation.json`                                                                                |
| A check that **could not run here**             | CodeRabbit has no CLI in CI; a link host rate-limits the link checker      | `environment.json`                                                                             |

## The record

Every record is an object with an `id` (derived from what it covers, so it survives unrelated edits
and goes stale when the covered code changes), a `version`, and a `justification`. A `version: 2`
record -- every record written from now on -- also carries the elements that make an exception
auditable instead of merely present:

| Field           | Answers                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `ruleBroken`    | Which rule of the standard is being broken?                                 |
| `attempted`     | What was tried first, and why did it not work?                              |
| `constraint`    | What technical constraint forced the exception?                             |
| `whyPreferable` | Why is the chosen outcome better than the alternatives?                     |
| `residualRisk`  | What risk remains, and who carries it?                                      |
| `revisitWhen`   | Under what condition must this record be reopened?                          |
| `expires`       | Optional `YYYY-MM-DD`. After it the record no longer counts. `""` for none. |

A blank field is an incomplete record: the check that owns the registry fails and names what is
missing. A freshly scaffolded stub is all blanks on purpose -- it exists so the finding is recorded and
the author has to fill it in. The legacy `version: 1` shape (only `justification`) is still read so a
registry can migrate record by record, but `internal-package-contract exceptions` counts what is left.

The security-family registries add `alternatives`, `remediation`, `method` and `exceptionType`:

- `exceptionType`: `validated-false-positive`, `accepted-risk`, `compensating-control`,
  `tooling-limitation`, `scheduled-remediation`, `platform-or-vendor-constraint`,
  `required-for-package-to-exist`, `dev-only-not-shipped`. Each registry accepts the subset that can be
  true for it (`SecuritySocket` never accepts a waiver for a critical or high alert at all).
- `method`: `mechanical-reverification` (a tool re-run confirms it; the only method that can back
  `validated-false-positive`), `independent-human-review`, or `policy-rule` (no individual reviewed it: a
  standing rule of the standard decided, e.g. `CodeScanning` rejecting an alert in test code by
  location -- and the record says so rather than claiming a review that never happened).

An exception is **not** a place to park unfinished work. If the honest `revisitWhen` is "when someone
gets round to it", fix the thing; `scheduled-remediation` is for a fix that is planned and tracked, with an
`expires` date.

## The registries

All live under `.repo-contract/exceptions/` and are committed. The header comment of each check
documents its record shape with a complete example.

| File                 | Check            | Id                                        | Covers                                         |
| -------------------- | ---------------- | ----------------------------------------- | ---------------------------------------------- |
| `socket.json`        | `SecuritySocket` | `socket:<package>@<version>:<alert type>` | an alert on the package's own Socket page      |
| `security-deps.json` | `SecurityDeps`   | `security-deps:<package>@<range>`         | an `npm audit` advisory                        |
| `dist-urls.json`     | `DistNoUrls`     | `dist-url:<url>`                          | a URL in a shipped file                        |
| `code-scanning.json` | `CodeScanning`   | `code-scanning:<rule>@<path>`             | a code-scanning alert in development-only code |
| `coderabbit.json`    | `CodeRabbit`     | `coderabbit:<file>:<severity>:<hash>`     | a CodeRabbit finding                           |
| `mutation.json`      | `Mutation`       | `mutation:<file>:<mutator>:<hash>`        | one mutant, matched by its source text         |
| `environment.json`   | any              | `environment:<Check>:<code>`              | a check that could not run (below)             |

Staleness is checked both ways: a finding with no complete record fails, and a record whose finding is
gone fails as stale -- delete it. The registry therefore always describes the code as it is. (The one
exception is `skipped-tests.json`: a suite that skips only on Windows has no skip on Linux, so an unused
record there is not an error.)

### When a check cannot run

Some results are not findings at all: the check never got to look. Chrome is missing so the
accessibility scan cannot start; the origin is not on GitHub so branch protection cannot be read; a link
host throttles the link checker. These never pass silently. The check records the degradation (it
appears in `reports/contract/report.json` and in the step summary with its own class) and:

- **locally** it is a `warn`, so a laptop without Chrome can still run the rest;
- **in CI** (`--strict`, the default when `CI` is set) it **fails**, unless `environment.json` holds a
  complete record `environment:<Check>:<code>` saying why that is acceptable there.

The codes are `Accessibility:no-chrome`, `Accessibility:no-site`, `BranchProtection:gh-unavailable`,
`Commits:no-base`, `Commits:pre-adoption`, `CodeRabbit:not-applicable` (CI), `CodeRabbit:unavailable` (no
CLI), and `DocsLinks:<url>` for each external link that could not be reached. The warn names the exact id
to add.

## Who approves, and how

Whoever approves the pull request approves the record: registries are ordinary files under
`CODEOWNERS`. A record added in a pull request is reviewed like the code it excuses. There is no side
channel -- a dismissed GitHub alert, a `// eslint-disable`, a `/* v8 ignore */` or a `// Stryker disable`
that no registry knows about is itself a finding (`Suppressions`).

## What is in force

```sh
npx internal-package-contract exceptions          # per registry: count, by type, legacy, expired, incomplete
npx internal-package-contract exceptions --json
```

The same inventory is attached to every contract run's `report.json` and step summary.
