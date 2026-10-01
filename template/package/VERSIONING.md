# Versioning

`{{name}}` follows [Semantic Versioning](https://semver.org). Versions are produced by
[Changesets](https://github.com/changesets/changesets), never by hand.

- **Patch** -- bug fixes and internal changes that do not alter the public API.
- **Minor** -- backwards-compatible additions. While the version is `0.x`, a breaking change is
  also released as a minor, and says so in its changeset.
- **Major** -- breaking changes to the public API, once the package is `1.0.0` or later.

The public API is whatever `package.json`'s `exports` map names. Anything else is private and may
change in any release.

<!-- TODO({{name}}): list stable / experimental / private surfaces here when they diverge. -->
