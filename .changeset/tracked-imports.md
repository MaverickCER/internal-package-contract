---
"internal-package-contract": minor
---

fix(git-hygiene): `GitHygiene` fails on an import in tracked source that resolves only to a file git does not track, which is how a `.gitignore` pattern that was too wide hid source from every clean checkout while every local check passed
