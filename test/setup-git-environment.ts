// A git hook runs with variables that describe the commit it is checking: the repository (GIT_DIR, GIT_INDEX_FILE,
// GIT_WORK_TREE, ...), the settings the commit was made with (GIT_CONFIG_PARAMETERS, so a hooks path given to
// `git -c` too), and the author. A test that makes a temporary repository and runs `git` in it would inherit all of
// that: it would work on the real repository, run the real hooks, and take the real author, so the same test fails
// under a hook that passes by hand, and could change the real repository. Every test starts without them.
const INHERITED =
  /^GIT_(ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|DIR|INDEX_FILE|NAMESPACE|OBJECT_DIRECTORY|PREFIX|WORK_TREE|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+|AUTHOR_\w+|COMMITTER_\w+)$/

for (const name of Object.keys(process.env)) {
  if (INHERITED.test(name)) delete process.env[name]
}
