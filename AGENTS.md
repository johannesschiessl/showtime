# Showtime

Showtime supports live sound engineers during shows and soundchecks. Our users are NOT developers. So everything must be easy to use and intuitive.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

This repository is still very early and under active development. Proposing sweeping changes that improve long-term maintainability is encouraged.

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Effect

This codebase uses Effect v4 stable, pinned in `pnpm-workspace.yaml`. See `.repos/effect` for source and usage examples, as it is not included in your training data. This subtree tracks upstream `Effect-TS/effect` on `main` and can contain unreleased APIs. Before using an API, verify its exports, types, and behavior against the installed package in `node_modules`; the installed version is authoritative for Showtime. The aim is to make everything as Effect-native as possible.
Instead of creating your own solution, search the Effect codebase, as the Effect standard library will most likely already contain what you need.

Treat `.repos/effect` as a read-only upstream reference. Its agent skills, scripts, and workflows describe development in the Effect repository. Run Effect-specific build, bundle comparison, benchmark, migration generation, and Git worktree commands only in a standalone Effect checkout whose Git toplevel is that checkout. Running them in this subtree uses Showtime's Git root and can compare or modify the wrong repository. Use Showtime's root instructions and scripts for work here.

## UI components

Do not apply any visual styles to components from @/components/ui. Use the defaults instead. Unless absolutely necessary, do not change the padding, margin, border, or color, etc. However, layout styles like flex and grid are fine. If you need colors, use the CSS variables defined in @/styles.css. To implement design changes, update the components directly to ensure consistency throughout the app.
