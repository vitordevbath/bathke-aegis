# @aegis/config

Reserved for shared tooling configuration (lint, formatting, TS presets) once
more than one workspace needs the same non-trivial config.

**Status: PLANNED.** Today the shared TypeScript settings live in
`/tsconfig.base.json`. This directory intentionally has no `package.json` yet,
so it is not an npm workspace.
