# @graphiti/core (vendored)

Vendored build of `@graphiti/core` from the `karimn/graphiti-ts` fork
(commit `5f23b5d5b3bd21d6ee864a4ae667ed6d0f35d0a6`), since CI and fresh
installs can't resolve a `file:` dependency pointing outside this repo.

`dist/` contains the bundled JS (`bun build`) and a hand-assembled `.d.ts`
tree (`tsc -p tsconfig.vendor.json` at the fork's root, which compiles
`packages/core` and `packages/shared` together to avoid the project's
per-package `rootDir` constraints). There is no `src/` here — this is a
build artifact, not a package to edit directly.

## Updating

1. In the fork (`~/Code/graphiti-ts` or wherever it's checked out), make
   the change, then from the repo root:
   ```bash
   cd packages/core && bun build ./src/index.ts --outdir dist --target node --format esm
   cd ../shared && bun build ./src/index.ts --outdir dist --target node --format esm
   cd ../.. && node_modules/.bin/tsc -p tsconfig.vendor.json
   ```
2. Copy `packages/core/dist/index.js` → here, and the matching `.d.ts`
   tree from `dist-vendor-tmp/packages/core/src/**` (drop the
   `packages/core/src` prefix).
3. Do the same for `packages/graphiti-shared` from `packages/shared`.
4. `bun install` at the agentic-rpg root to relink the workspace.
