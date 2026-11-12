#!/usr/bin/env node
// Entry point for the `AgentSkill` check (see checks/agent-skill.ts). Reads docs/skill.json and what is
// written under skills/ through scripts/skill/inspect.mjs, and prints one JSON envelope: the state, the
// problems, what is stale, and the manual's word count against its budget. It writes nothing; the policy
// decides the verdict.

import { inspectSkill } from "./skill/inspect.mjs"

const { state, problems, notes, stale, words, budget } = inspectSkill(process.cwd())

process.stdout.write(JSON.stringify({ ok: true, state, problems, notes, stale, words, budget }))
