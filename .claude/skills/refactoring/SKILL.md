---
name: refactoring
description: Disciplined refactoring after Martin Fowler's "Refactoring" (2nd ed.) - two hats, small behaviour-preserving steps under green tests, a code-smell catalog mapped to named refactorings, adapted to this TypeScript/GJS codebase. Use in the TDD refactor step, when a reviewer reports a smell, or when asked to refactor or clean up code.
---

# Refactoring

> Refactoring: changing the internal structure of code, through small behaviour-preserving
> transformations, so that it is easier to understand and cheaper to modify.
> (After Martin Fowler, _Refactoring: Improving the Design of Existing Code_, 2nd ed., 2018.)

## Rules

1. **Two hats.** You are either adding behaviour or refactoring, never both at once. While
   refactoring: no new features, no bug fixes, no test changes except mechanical renames. If you
   find a bug, note it, finish or revert the refactoring, then fix the bug test-first.
2. **Green to green.** Start only on a green suite. After **every** step, run the affected tests
   (`npm test -- <file>`). If a step turns them red and the cause is not obvious in a minute,
   revert the step instead of debugging it: the step was too big.
3. **Small steps.** Each step is one named refactoring from the table below, or a smaller part of
   one. Many tiny safe steps beat one clever leap.
4. **No tests, no refactoring.** If the code is not covered, first write characterisation tests
   that pin down its current behaviour (through `test-author`), then refactor.
5. **Separate commits.** `refactor(scope): …` commits contain no behaviour change, and the test
   suite passes unchanged before and after.
6. **Clarity first, speed later.** Write clear code, then measure against the budget in
   `docs/ENGINEERING.md#6-performance-budget`. Optimise only measured hot spots.

## When

- **Preparatory**: before a feature, reshape the code so that the feature becomes a small, easy
  change. Then add it.
- **Comprehension**: when understanding code took effort, put that understanding into names and
  structure.
- **Litter pick-up**: leave every file you touch a little better, within the task's scope.
- **Rule of three**: tolerate duplication once; the third occurrence gets extracted.
- **Not** when the code works, is not being changed and nobody needs to read it; not while
  tests are red; not across a published interface without a migration (see below).

## Published interfaces in this project

Internal TypeScript APIs (ports, core modules) can change freely: rename callers in the same
step. These are **published** and need a migration plan and an ADR before any change:

- GSettings keys and their types (users' dconf data)
- `metadata.json` `uuid`, schema id, gettext domain
- The `.deb` package name and installed paths

## Smell catalog → refactorings

| Smell                                         | What it looks like here                                                     | Refactorings                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Mysterious name                               | `data`, `handle()`, `info`, `tmp`, units missing (`timeout` vs `timeoutMs`) | Rename Variable, Change Function Declaration, Rename Field                                                               |
| Duplicated code                               | The same status-code mapping in the presenter and the monitor               | Extract Function, Slide Statements, Pull Up Method                                                                       |
| Long function                                 | A poll handler that fetches, decodes, diffs and renders                     | Extract Function, Split Phase, Decompose Conditional, Replace Temp with Query                                            |
| Long parameter list                           | `render(name, project, status, cpu, mem, …)`                                | Introduce Parameter Object, Preserve Whole Object, Remove Flag Argument                                                  |
| Global data                                   | Module-level mutable state in `ui/` or `core/`                              | Encapsulate Variable, then move it into an object created in `enable()`                                                  |
| Mutable data                                  | Snapshots mutated after creation                                            | Encapsulate Variable, Split Variable, Change Reference to Value (`readonly`)                                             |
| Divergent change                              | One module edited for unrelated reasons (HTTP framing _and_ Incus fields)   | Split Phase, Extract Function, Move Function                                                                             |
| Shotgun surgery                               | One new instance state touches six files                                    | Move Function, Combine Functions into Transform, Inline Class                                                            |
| Feature envy                                  | UI code computing CPU % from raw counters                                   | Move Function (to `core/metrics.ts`), Extract Function                                                                   |
| Data clumps                                   | `name` + `project` passed together everywhere                               | Introduce Parameter Object (`InstanceRef`), Extract Class                                                                |
| Primitive obsession                           | Status as `string`, sizes as bare numbers with implied units                | Replace Primitive with Object, a string-literal union, or branded types                                                  |
| Repeated switches                             | `switch (status)` in several modules                                        | One exhaustive switch or lookup table in one place; Replace Conditional with Polymorphism only if behaviour varies a lot |
| Loops                                         | Manual accumulation loops                                                   | Replace Loop with Pipeline (`filter`/`map`/`reduce`) where it reads better                                               |
| Lazy element                                  | A wrapper or class that only forwards                                       | Inline Function, Inline Class, Collapse Hierarchy                                                                        |
| Speculative generality                        | Options, hooks or parameters with no caller                                 | Remove Dead Code, Collapse Hierarchy, Inline Function, Change Function Declaration                                       |
| Temporary field                               | A field that is set only during one operation                               | Extract Class, Introduce Special Case                                                                                    |
| Message chains                                | `this.a.b.c.d()`                                                            | Hide Delegate, Extract Function, Move Function                                                                           |
| Middle man                                    | A class that only delegates                                                 | Remove Middle Man, Inline Function                                                                                       |
| Insider trading                               | Adapters reaching into core internals, or the reverse                       | Move Function, Hide Delegate, a port in `core/ports.ts`                                                                  |
| Large class                                   | An `Indicator` that also polls and formats                                  | Extract Class, Extract Superclass, Replace Type Code with Subclasses                                                     |
| Alternative classes with different interfaces | Two fakes for the same port with different methods                          | Change Function Declaration, Move Function, Extract Superclass                                                           |
| Data class                                    | Getter-only bags whose logic lives elsewhere                                | Move Function into the type's module, Encapsulate Record                                                                 |
| Refused bequest                               | A subclass that ignores most of what it inherits                            | Push Down Method, Replace Subclass with Delegate, Replace Superclass with Delegate                                       |
| Comments                                      | A comment that explains _what_ a block does                                 | Extract Function named after the comment, Rename, Introduce Assertion                                                    |

## Project-specific adaptations

- **Errors**: this codebase returns `Result` values instead of throwing (ENGINEERING §2). Where
  the book suggests Replace Error Code with Exception, use a typed `IncusError` in a `Result`.
- **Unions over class hierarchies**: prefer discriminated unions with one exhaustive switch.
  Use classes (and polymorphism) for things with identity and lifecycle: adapters, widgets,
  the monitor.
- **Split Phase** is the backbone of the core: bytes → HTTP response → envelope → domain model →
  snapshot → view model. When a function spans two phases, split it.
- **GObject classes** (`registerClass`) cannot be freely renamed: changing `GTypeName` is a
  rename. Keep the `IncusMonitor` prefix and treat it as internal, not published.
- **Moves across layers** must respect `docs/ARCHITECTURE.md`. Lint will tell you; never
  silence it.

## Procedure (for agents)

1. Run the suite and record that it is green.
2. Name the smell and the planned refactorings: "Feature envy in `ui/instance-item.ts:42` →
   Move Function `cpuPercent` to `core/metrics.ts`".
3. Apply one step, run the tests, and repeat.
4. Run `make check`. Diff review: the behaviour diff is empty, and the test files changed only
   by mechanical renames.
5. Report:

```text
REFACTORING: <scope>
SMELLS → REFACTORINGS: <smell @ file:line → refactoring(s)>
STEPS: <n> (tests green after each)
BEHAVIOUR CHANGE: none
FOLLOW-UPS: <bugs or larger smells noticed, out of scope>
```
