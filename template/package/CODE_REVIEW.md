# Code review

A review answers one question: is this change correct, safe and maintainable enough to ship?
`npm run contract` has already checked formatting, types, tests, coverage, mutation score, packaging,
dependency advisories, secrets and code-scanning alerts, so a reviewer spends their attention on what a
tool cannot judge. Socket scores the version already published, so a new dependency is first scored
after it ships.

## Checklist

- **Behavior** -- does it do what the description says, including the unhappy paths?
- **Tests** -- would they fail if the behavior regressed? Prefer asserting outcomes over internals.
- **Public API** -- is any exported name, type or runtime behavior changing? The changeset must say
  so, and match [VERSIONING.md](VERSIONING.md).
- **Dependencies** -- is a new dependency justified? A shipped dependency with a critical or high Socket
  alert fails `SecuritySocket` once published; prefer writing the few lines yourself.
- **Shipped output** -- no URLs, no minified code (`DistNoUrls`, `NoMinify` enforce this).
- **Exceptions** -- every waiver in `.repo-contract/exceptions/` needs a specific, honest reason.
- **Docs** -- README and API docs reflect the change.

<!-- ipc:prompt: add package-specific review points. -->
