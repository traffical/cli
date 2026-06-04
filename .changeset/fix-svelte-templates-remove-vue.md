---
"@traffical/cli": patch
---

Fix Svelte/SvelteKit scaffold templates to use the real API (`TrafficalProvider` + `useTraffical` with Svelte 5 runes) instead of the nonexistent `getTraffical`/`$params`, and remove a redeclared-variable compile error. Stop advertising Vue/Nuxt: there is no `@traffical/vue` package yet, so those projects now fall back to the Node SDK rather than scaffolding broken imports. Removes a dead, unused skill generator.
