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

This codebase uses Effect v4 stable. See '.repos/effect' for how to use it, as it is not included in your training data. The aim is to make everything as Effect-native as possible.
Instead of creating your own solution, search the Effect codebase, as the Effect standard library will most likely already contain what you need.

## UI components

Do not apply any visual styles to components from @/components/ui. Use the defaults instead. Unless absolutely necessary, do not change the padding, margin, border, or color, etc. However, layout styles like flex and grid are fine. If you need colors, use the CSS variables defined in @/styles.css. To implement design changes, update the components directly to ensure consistency throughout the app.
