# Versioning

`{{name}}` follows [Semantic Versioning](https://semver.org). Versions are produced by
[Changesets](https://github.com/changesets/changesets), never by hand.

- **Patch** -- bug fixes and internal changes that do not alter the public API.
- **Minor** -- backwards-compatible additions. While the version is `0.x`, a breaking change is
  also released as a minor, and says so in its changeset.
- **Major** -- breaking changes to the public API, once the package is `1.0.0` or later.

The public API is whatever `package.json`'s `exports` map names. Anything else is private and may
change in any release.

## What the version number covers

Two checks compare each branch with the last release and fail unless its changeset declares a
large enough bump:

- **TypeScript API** -- every entry point in `exports` that exposes types (`ApiContract`).
- **Everything else a user can depend on** (`SurfaceContract`) -- the `--help` text and exit code of
  each `bin`, every JSON file `exports` serves (schemas and shared configs), and the inputs and
  outputs of the root `action.yml`. Removing or changing any of them is a breaking change; adding an
  optional flag, property or input is a minor change from `1.0.0`; rewording a description is a patch.

Neither check sees a change in behaviour behind an unchanged signature or `--help` text, or in the
files a command writes. Those are judged in review, and a changeset says so when they matter.

<!-- TODO({{name}}): list stable / experimental / private surfaces here when they diverge. -->
