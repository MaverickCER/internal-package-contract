#!/usr/bin/env node
// Entry point for the `AgentSkill` check (see checks/agent-skill.ts). Reads the package's docs/skill.json and
// what is written under skills/ and prints one JSON envelope; it writes nothing.

import { inspectSkill } from "./skill/inspect.mjs"

const { state, problems, notes, stale, words, budget } = inspectSkill(process.cwd())

process.stdout.write(JSON.stringify({ ok: true, state, problems, notes, stale, words, budget }))
