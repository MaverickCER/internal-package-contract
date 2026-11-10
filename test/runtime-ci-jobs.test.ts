import { describe, expect, it } from "vitest"
import {
  DEFAULT_CI_JOBS_OPTIONS,
  auditCiJobs,
  ciJobsOptions,
  parseJobs,
} from "../runtime/ci-jobs.js"

const WORKFLOW = `name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  lint:
    if: true
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint
  verify:
    strategy:
      matrix:
        node: [22, 24]
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  verify-current:
    continue-on-error: true
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  contract:
    needs: [verify, lint]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: npm run contract
  cross-runtime:
    needs:
      - verify
      - "lint"
    runs-on: ubuntu-latest
    steps:
      - run: npm run cross-runtime
  badges:
    needs: [contract]
    runs-on: ubuntu-latest
    steps:
      - run: echo badges
  required:
    needs: [verify, contract, cross-runtime]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Every gate job succeeded
        env:
          NEEDS: \${{ toJSON(needs) }}
        run: node -e "process.exit(0)"
  deploy:
    needs: [required]
    runs-on: ubuntu-latest
    steps:
      - run: echo deploy
`

describe("parseJobs()", () => {
  it("reads every job id, its needs (inline or as a block list) and continue-on-error", () => {
    expect(parseJobs(WORKFLOW)).toEqual([
      { id: "lint", needs: [], continueOnError: false },
      { id: "verify", needs: [], continueOnError: false },
      { id: "verify-current", needs: [], continueOnError: true },
      { id: "contract", needs: ["verify", "lint"], continueOnError: false },
      { id: "cross-runtime", needs: ["verify", "lint"], continueOnError: false },
      { id: "badges", needs: ["contract"], continueOnError: false },
      { id: "required", needs: ["verify", "contract", "cross-runtime"], continueOnError: false },
      { id: "deploy", needs: ["required"], continueOnError: false },
    ])
  })

  it("reads a single needs value, a quoted one, and continue-on-error that is not plainly true", () => {
    const jobs = parseJobs(
      "jobs:\n  a:\n    needs: b\n    continue-on-error: ${{ false }}\n  b:\n    needs: 'a'\n",
    )
    expect(jobs).toEqual([
      { id: "a", needs: ["b"], continueOnError: false },
      { id: "b", needs: ["a"], continueOnError: false },
    ])
  })

  it("reads list items only under a block-list needs, never after an inline one or another key", () => {
    expect(
      parseJobs("jobs:\n  a:\n    needs: [b]\n      - c\n    steps:\n      - run: x\n"),
    ).toEqual([{ id: "a", needs: ["b"], continueOnError: false }])
  })

  it("tolerates trailing spaces after `jobs:` and after a block-list `needs:`", () => {
    expect(parseJobs("jobs:   \n  a:\n    needs:  \n      - b\n  b:\n    runs-on: x\n")).toEqual([
      { id: "a", needs: ["b"], continueOnError: false },
      { id: "b", needs: [], continueOnError: false },
    ])
  })

  it("ignores indented lines before any job, and job keys before any job id", () => {
    expect(parseJobs("  a:\n    runs-on: x\n")).toEqual([])
    expect(
      parseJobs("jobs:\n    needs: [x]\n      - y\n  a:\n      - stray\n    runs-on: x\n"),
    ).toEqual([{ id: "a", needs: [], continueOnError: false }])
  })

  it("stops reading needs items at the next job key, and ignores keys deeper than a job's own", () => {
    const jobs = parseJobs(
      "jobs:\n  a:\n    needs:\n      - b\n    runs-on: x\n      - not-a-need\n    steps:\n      - run: echo\n        needs: nope\n  b:\n    runs-on: x\n",
    )
    expect(jobs).toEqual([
      { id: "a", needs: ["b"], continueOnError: false },
      { id: "b", needs: [], continueOnError: false },
    ])
  })

  it("reads only the jobs section, however the top-level keys are ordered", () => {
    expect(parseJobs("jobs:\n  a:\n    runs-on: x\nenv:\n  b:\n    c: d\n")).toEqual([
      { id: "a", needs: [], continueOnError: false },
    ])
    expect(parseJobs("env:\n  a: 1\n")).toEqual([])
    expect(parseJobs("")).toEqual([])
  })
})

describe("auditCiJobs()", () => {
  it("passes a workflow whose required job waits for every gate job", () => {
    expect(auditCiJobs(WORKFLOW)).toEqual([])
  })

  it("names a gate job the required job does not wait for", () => {
    const workflow = WORKFLOW.replace(
      "needs: [verify, contract, cross-runtime]",
      "needs: [verify, contract]",
    )
    expect(auditCiJobs(workflow)).toEqual([
      "`cross-runtime` is not in `required.needs`, so its result does not block a merge",
    ])
  })

  it("names a need that is not a job, and an advisory job that does not say it may fail", () => {
    const workflow = WORKFLOW.replace(
      "needs: [verify, contract, cross-runtime]",
      "needs: [verify, contract, cross-runtime, gone]",
    ).replace("    continue-on-error: true\n", "")
    expect(auditCiJobs(workflow)).toEqual([
      "`required.needs` names `gone`, which is not a job",
      "`verify-current` is advisory but does not carry `continue-on-error: true`",
    ])
  })

  it("is quiet about an advisory job the workflow does not have", () => {
    expect(auditCiJobs("jobs:\n  a:\n    runs-on: x\n  required:\n    needs: [a]\n")).toEqual([])
  })

  it("reports a workflow it cannot read, or one with no aggregator, rather than passing it", () => {
    expect(auditCiJobs("on: push\n")).toEqual([
      "the workflow has no `jobs:` section this audit can read",
    ])
    expect(auditCiJobs("jobs:\n  a:\n    runs-on: x\n")).toEqual([
      "the workflow has no `required` job",
    ])
  })

  it("takes the aggregator, exempt and advisory lists from the options", () => {
    const options = { aggregator: "gate", exempt: ["lint"], advisory: ["canary"] }
    const workflow =
      "jobs:\n  lint:\n    runs-on: x\n  canary:\n    continue-on-error: true\n    runs-on: x\n  build:\n    runs-on: x\n  gate:\n    needs: [build]\n    runs-on: x\n"
    expect(auditCiJobs(workflow, options)).toEqual([])
    expect(auditCiJobs(workflow.replace("needs: [build]", "needs: []"), options)).toEqual([
      "`build` is not in `gate.needs`, so its result does not block a merge",
    ])
  })
})

describe("ciJobsOptions()", () => {
  it("is the fleet layout by default", () => {
    expect(ciJobsOptions({})).toEqual(DEFAULT_CI_JOBS_OPTIONS)
    expect(ciJobsOptions({ "internal-package-contract": {} })).toEqual(DEFAULT_CI_JOBS_OPTIONS)
    expect(DEFAULT_CI_JOBS_OPTIONS).toEqual({
      aggregator: "required",
      exempt: ["contract", "lint", "required", "badges", "deploy", "pages-content", "pr-title"],
      advisory: ["verify-current"],
    })
  })

  it("takes each list a package.json overrides, and keeps the defaults for the rest", () => {
    expect(
      ciJobsOptions({ "internal-package-contract": { ciJobs: { exempt: ["contract", "docs"] } } }),
    ).toEqual({
      aggregator: "required",
      exempt: ["contract", "docs"],
      advisory: ["verify-current"],
    })
    expect(
      ciJobsOptions({
        "internal-package-contract": { ciJobs: { aggregator: "gate", advisory: [] } },
      }),
    ).toEqual({ aggregator: "gate", exempt: DEFAULT_CI_JOBS_OPTIONS.exempt, advisory: [] })
  })
})
