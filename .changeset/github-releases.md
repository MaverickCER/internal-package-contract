---
"internal-package-contract": patch
---

The shared release workflow creates a GitHub Release for each version it publishes, with the notes taken from that version's CHANGELOG section in the published tarball (GitHub's generated notes when the package ships no CHANGELOG). Until now it created only the tag, so the Releases page stopped at the last release made before the tag-only flow. A failure creating the Release is shown on its step but never skips the npm verification that follows.
