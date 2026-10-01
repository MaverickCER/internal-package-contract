# Code review

A review answers one question: is this change correct, safe and maintainable enough to ship?
`npm run contract` has already proven formatting, types, tests, coverage, mutation score, security
and packaging, so a reviewer spends their attention on what a tool cannot judge.

## Checklist

- **Behavior** -- does it do what the description says, including the unhappy paths?
- **Tests** -- would they fail if the behavior regressed? Prefer asserting outcomes over internals.
- **Public API** -- is any exported name, type or runtime behavior changing? The changeset must say
  so, and match [VERSIONING.md](VERSIONING.md).
- **Dependencies** -- is a new dependency justified? Shipped dependencies must have a clean
  Socket.dev score; prefer writing the few lines yourself.
- **Shipped output** -- no URLs, no minified code (`DistNoUrls`, `NoMinify` enforce this).
- **Exceptions** -- every waiver in `.repo-contract/exceptions/` needs a specific, honest reason.
- **Docs** -- README and API docs reflect the change.

<!-- TODO({{name}}): add package-specific review points. -->
