# ADR-0002: TypeScript compiled with tsc, typed by @girs

- Status: Accepted
- Date: 2026-10-04

## Context

The code must be easy for contributors and EGO reviewers to read, and safe to change.
gjs.guide documents TypeScript with the `@girs/*` typings as a supported workflow. EGO rejects
minified or obfuscated JavaScript and requires TypeScript to transpile to well-formatted
JavaScript.

## Decision

- Write all sources in strict TypeScript (`tsconfig.json`) and compile with `tsc` alone, one
  output file per source module. No bundler.
- Format the emitted JavaScript with Prettier in `scripts/build.sh`.
- Pin `typescript` to 6.0.x. typescript-eslint 8 does not yet support TypeScript 7 (the native
  compiler); revisit when it does.
- Type against `@girs/gnome-shell` 50. This catches misuse, but not APIs missing on 46: see
  the API ledger in [COMPATIBILITY.md](../COMPATIBILITY.md).

## Consequences

- There is a compile step, but the output maps one to one to the sources.
- The typings can lag behind the Shell. Local `declare module` augmentations go in
  `ambient.d.ts`, with a comment and a link.

## Alternatives considered

- **JavaScript with JSDoc and `checkJs`**: no build step, but weaker types and noisier code.
- **esbuild or rollup bundle**: smaller tree, but less readable for EGO review, and it hides the
  module structure.
