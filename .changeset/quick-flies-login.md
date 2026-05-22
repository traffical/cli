---
"@traffical/cli": minor
---

Add browser-based onboarding flow centered on `traffical login` and a refactored `traffical init`.

- `login` / `logout` / `whoami` using OAuth 2.0 Device Authorization Grant against the control plane (which proxies WorkOS). Sessions persist to `~/.config/traffical/auth.json` with mode `0600`, auto-refresh on expiry, and serialize refreshes via a file lock.
- New `link` / `unlink`, `org list|use`, `project list|create|use` commands.
- `init` is now an orchestrator: triggers login if needed, picks or creates a project, writes `.traffical/project.yaml`, provisions a project-scoped SDK key into `.traffical/.env`, and scaffolds `config.yaml` / `AGENTS.md` / `TEMPLATES.md`. Never overwrites existing files without `--force`.
- The project link moves from a `project:` block inside `config.yaml` to its own `.traffical/project.yaml` (read-back-compat is preserved).
- Added exit code `4` (`not_linked`); JSON-mode errors now carry `{code, message, hint, exit_code}`. Tokens are redacted in all logs.
- New env vars: `TRAFFICAL_API_TOKEN` (pre-minted JWT, for CI/agents) alongside the existing `TRAFFICAL_API_KEY`.
