---
name: adversarial-review
description: Runs the adversarial multi-reviewer code review for this repo and triages the findings (dedupe, verify, rank, rule on rebuttals). Use for any review request on this repository, inside implement-task, or standalone on a branch or MR diff.
---

# Adversarial review

## Standalone use

1. Determine the scope: `git diff main...HEAD` by default, or the paths or MR the user names.
2. Run `make check` first and include the result. A red check is itself a blocker.
3. Spawn, in parallel, with identical inputs (scope, relevant ROADMAP criteria, and
   `docs/ENGINEERING.md`): `reviewer-correctness`, `reviewer-security`, `reviewer-gnome`,
   `reviewer-design`, plus `reviewer-ux` if the UI or user-visible strings changed.
4. Triage (below), then present the result to the user.

## Severity rubric

| Severity | Meaning                                                                                                                      | Merge?                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| blocker  | Wrong behaviour, crash, leak after disable, EGO rejection, security issue, red check                                         | No                         |
| major    | Likely bug under realistic conditions, boundary violation, untested branch, API not verified on GNOME 46, docs contradiction | No                         |
| minor    | Clarity, naming, small simplification                                                                                        | Yes, fix opportunistically |
| nit      | Taste                                                                                                                        | Yes, may ignore            |

## Triage procedure

1. **Normalise**: give every finding an ID (`C1`, `S2`, `G3`, `D4`, `U5`).
2. **Deduplicate**: merge findings with the same root cause, keep the highest severity, and
   credit every reviewer who raised it.
3. **Verify** each blocker and major, and do not skip this step:
   - Write a throwaway test in the scratchpad, or ask `test-author` for a regression test, and
     run it. A failing test is verification.
   - Or trace the exact code path and quote it.
   - Findings you cannot verify are dropped and listed under "Unverified": never silently.
4. **Re-grade** when the evidence contradicts the reviewer's severity. Note why.
5. **Rebuttals**: the implementer may rebut once with evidence. Send the rebuttal to the original
   reviewer. Their ruling stands, unless it contradicts a verified test result. Unresolved
   disagreements go to the user.
6. **Output**:

```text
REVIEW: <scope>   ROUND: <n>   CHECK: ✔/✘
BLOCKERS (verified): …
MAJORS (verified): …
MINORS: …
UNVERIFIED (dropped): …
REBUTTALS: <id>: upheld/overturned, reason
DECISION: merge-ready | fix round <n+1> | escalate to maintainer
```

## Anti-patterns to reject

- Findings without a concrete failure scenario.
- Style comments that Prettier or ESLint already settle.
- "Consider adding…" for anything not required by a current task: that is scope creep.
- A reviewer's praise or summary text. Strip it.
