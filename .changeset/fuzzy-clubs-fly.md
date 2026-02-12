---
"@traffical/cli": minor
---

Add --framework flag for non-interactive init and fix templates

- Add `--framework <framework>` flag to skip interactive framework selection during `init`
- Improve `--api-key` help text to mention `~/.trafficalrc` fallback
- Add `orgId` and `env` to all `createTrafficalClient` examples in TEMPLATES.md
