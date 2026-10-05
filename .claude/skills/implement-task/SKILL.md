---
name: implement-task
description: Orchestrates one ROADMAP task end to end - test-author (red), implementer (green/refactor), parallel adversarial reviewers, verified triage, bounded fix loop, docs. Use when asked to implement, build or work on a task such as "T02" or "/implement-task T05".
---

# Implement a ROADMAP task

Argument: a task ID from `docs/ROADMAP.md` (for example `T02`). You are the **orchestrator**: you
delegate, verify and decide. You do not write production code or tests yourself.

## 0. Preflight

1. Read `docs/ROADMAP.md`. Confirm that the task's dependencies are `done`. If not, stop and say
   which are missing.
2. Read the acceptance criteria and the docs they link. If the criteria are ambiguous, ask the
   user **before** spawning anything.
3. Run `make check`. If the baseline is red, stop and report: never build on a red baseline.
4. Set the task status to `in-progress` in ROADMAP.md.

## 1. Red: `test-author`

Spawn `test-author` with the task ID, the full acceptance criteria text, and the relevant doc
paths. When it returns:

- Run the new tests yourself. Confirm that each one fails, **for the reason stated**. If any
  test passes already or fails for a wrong reason (a syntax error or a bad import path), send it
  back with the evidence.
- Check the tests against the criteria. Any criterion not covered either gets a test, or is
  explicitly recorded as manual-only.

## 2. Green: `implementer`

Spawn `implementer` with the test-author's report (tests, intended API, red evidence). For
tasks that can run in parallel, use `isolation: "worktree"`. When it returns, run
`make check` (and `make test-gjs` and `make build` where relevant) **yourself**. Do not
trust reported results.

## 3. Adversarial review

Collect the diff (`git diff` against the task's base, or the list of changed files). Spawn **in
parallel, in one message**:

- `reviewer-correctness`
- `reviewer-security`
- `reviewer-gnome`
- `reviewer-design`
- `reviewer-ux`, only if `src/ui/`, `src/prefs.ts`, `data/stylesheet.css` or user-visible strings
  changed

Give each the same inputs: task ID, criteria, changed files, and the implementer's design
notes. Do **not** share one reviewer's output with another.

## 4. Triage

Load the `adversarial-review` skill and follow its triage procedure. In short:

1. Deduplicate findings across reviewers.
2. **Verify** each blocker and major: reproduce it with a test or trace the code path. Drop what
   you cannot verify, and say so.
3. Produce a ranked list: verified blockers and majors, then accepted minors.

## 5. Fix loop (at most 3 rounds)

For each verified blocker or major: `test-author` writes a failing regression test, then
`implementer` fixes it (it may rebut once with evidence; the originating reviewer rules on the
rebuttal). Re-run only the reviewers whose findings were addressed, plus `reviewer-correctness`.

After round 3 with open blockers or majors: **stop**. Report the stalemate to the user with the
findings and your assessment.

## 6. Close

1. Apply accepted minors through the implementer as a separate refactoring pass (the
   `refactoring` skill: no behaviour change, tests unchanged), then run checks once more.
2. Make sure docs reflect reality: ARCHITECTURE module map, COMPATIBILITY ledger, INCUS_API, a
   new ADR if a significant decision was made. Propose a user-facing Conventional Commit subject
   (the changelog is generated from commits, ADR-0011).
3. Set the task status to `review` in ROADMAP.md. The maintainer sets `done` when merging.
4. Give the user a short report: what was built, the tests added, the findings (fixed, dropped
   as unverifiable, rebutted), and anything that needs a human decision. Do not commit.
