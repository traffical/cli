# @traffical/cli

## 0.12.0

### Minor Changes

- a77a87e: `traffical init` provisions a publishable key alongside the server key.

  Init previously minted one key — a server SDK key — and the Svelte template it
  scaffolded read it from `VITE_TRAFFICAL_API_KEY`. Vite inlines `VITE_*` into the
  client bundle, so the CLI's own happy path shipped a secret key to the browser.
  That key grants access to the project's full ruleset.

  `init` now mints a pair and writes both to `.traffical/.env`:

  | Variable                    | Key              | Belongs            |
  | --------------------------- | ---------------- | ------------------ |
  | `TRAFFICAL_API_KEY`         | `traffical_sk_…` | server only        |
  | `TRAFFICAL_PUBLISHABLE_KEY` | `traffical_pk_…` | client-facing code |

  Client templates now reference `VITE_TRAFFICAL_PUBLISHABLE_KEY`. Server templates
  are unchanged — they already used `process.env.TRAFFICAL_API_KEY` correctly.

  `createApiKey` sends the new `kind` field and keeps sending `scopes`, so a control
  plane that predates key kinds still derives the right class from the scopes. If the
  publishable key cannot be created — an older control plane rejects `kind` — init
  warns and continues rather than failing; you still get a working server key.

  `redactToken` renders Traffical API keys as `traffical_<kind>_…<last4>`, matching
  the dashboard and the control plane's stored `key_prefix`, so a key in CLI output
  can be matched against the one in Settings → API Keys. Revealing the last 4 of a
  40-character base62 body costs ~24 of 238 bits. OAuth session tokens from
  `traffical login` carry no kind and keep the previous leading-12 form.

  The `--json` output of `init` gains `sdk_key.publishable_key_prefix`.

## 0.11.0

### Minor Changes

- 1948e03: Make `whoami` trustworthy and `init` ambiguity errors actionable in one shot.

  - `whoami --verify` validates the session against the server instead of trusting the cached token, so it can no longer report `authenticated: true` when the session has actually ended (exits `2` if the session is dead). Plain `whoami` now notes it is a cached, non-live check. JSON output gains a `verified` field (`true` | `false` | `null`).
  - `init` ambiguity errors now name both `--org` and `--project` up front (instead of failing one axis per run) and attach the available orgs/projects as structured `details` in JSON output, so agents can resolve them without separate `org list` / `project list` calls.

## 0.10.0

### Minor Changes

- f1b0eab: Added metric sync

### Patch Changes

- c515c2b: Fix Svelte/SvelteKit scaffold templates to use the real API (`TrafficalProvider` + `useTraffical` with Svelte 5 runes) instead of the nonexistent `getTraffical`/`$params`, and remove a redeclared-variable compile error. Stop advertising Vue/Nuxt: there is no `@traffical/vue` package yet, so those projects now fall back to the Node SDK rather than scaffolding broken imports. Removes a dead, unused skill generator.

## 0.9.0

### Minor Changes

- adca00d: Add browser-based onboarding flow centered on `traffical login` and a refactored `traffical init`.

  - `login` / `logout` / `whoami` using OAuth 2.0 Device Authorization Grant against the control plane (which proxies WorkOS). Sessions persist to `~/.config/traffical/auth.json` with mode `0600`, auto-refresh on expiry, and serialize refreshes via a file lock.
  - New `link` / `unlink`, `org list|use`, `project list|create|use` commands.
  - `init` is now an orchestrator: triggers login if needed, picks or creates a project, writes `.traffical/project.yaml`, provisions a project-scoped SDK key into `.traffical/.env`, and scaffolds `config.yaml` / `AGENTS.md` / `TEMPLATES.md`. Never overwrites existing files without `--force`.
  - The project link moves from a `project:` block inside `config.yaml` to its own `.traffical/project.yaml` (read-back-compat is preserved).
  - Added exit code `4` (`not_linked`); JSON-mode errors now carry `{code, message, hint, exit_code}`. Tokens are redacted in all logs.
  - New env vars: `TRAFFICAL_API_TOKEN` (pre-minted JWT, for CI/agents) alongside the existing `TRAFFICAL_API_KEY`.

## 0.8.0

### Minor Changes

- 0daf842: Support measure, measureDisplayName, and desiredDirection fields on event properties in traffical.yaml, enabling numeric properties to be promoted as additional fact measures during push/pull sync.

## 0.7.0

### Minor Changes

- b03b3b6: Handle parameter states, add --prune option to archive orphaned synced parameters
- 49e0483: Add event schema support: property definitions in traffical.yaml with JSON Schema-based validation, property groups for reusable schemas, `typegen` command for generating typed event interfaces (TypeScript), and `--include-types` flag on `pull` command.

### Patch Changes

- 4b5cd76: streamline config reading and validation in push command

## 0.6.0

### Minor Changes

- d3d84ec: Auto-create project-scoped SDK key on init

  `traffical init` now automatically creates a project-scoped SDK key (sdk:read, sdk:write) via the Management API and saves it to `.traffical/.env`. A `.traffical/.gitignore` is also created to ensure the key is never committed. Pass `--no-sdk-key` to skip this step.

- d3d84ec: Simplify AI agent integration, rely on installable skill

  - Slim down generated AGENTS.md to project-specific quick reference with pointers to TEMPLATES.md and the installable skill (`npx skills add traffical/skills`)
  - Remove Claude-specific SKILL.md generation from `init` (replaced by the installable skill at `traffical/skills`)
  - Remove `integrate-ai-tools` command (replaced by the installable skill)
  - Add skill installation hint to `init` output

- d0b4bc3: Add namespace-as-key-prefix support: parameters are now grouped by namespace in config files, with local keys under a namespaces: block. The flat format with explicit namespace fields is still accepted on read.
- d3d84ec: Add --framework flag for non-interactive init and fix templates

  - Add `--framework <framework>` flag to skip interactive framework selection during `init`
  - Improve `--api-key` help text to mention `~/.trafficalrc` fallback
  - Add `orgId` and `env` to all `createTrafficalClient` examples in TEMPLATES.md

## 0.5.0

### Minor Changes

- 358a3b6: Add --yes and --project flags for fully non-interactive init, import events during init and scaffold empty events block in config.yaml

## 0.4.0

### Minor Changes

- 6baa4ef: Simplify AI agent integration, rely on installable skill

  - Slim down generated AGENTS.md to project-specific quick reference with pointers to TEMPLATES.md and the installable skill (`npx skills add traffical/skills`)
  - Remove Claude-specific SKILL.md generation from `init` (replaced by the installable skill at `traffical/skills`)
  - Remove `integrate-ai-tools` command (replaced by the installable skill)
  - Add skill installation hint to `init` output

## 0.3.0

### Minor Changes

- d077922: Add --framework flag for non-interactive init and fix templates

  - Add `--framework <framework>` flag to skip interactive framework selection during `init`
  - Improve `--api-key` help text to mention `~/.trafficalrc` fallback
  - Add `orgId` and `env` to all `createTrafficalClient` examples in TEMPLATES.md

## 0.2.0

### Minor Changes

- fd3c8e2: Auto-create project-scoped SDK key on init

  `traffical init` now automatically creates a project-scoped SDK key (sdk:read, sdk:write) via the Management API and saves it to `.traffical/.env`. A `.traffical/.gitignore` is also created to ensure the key is never committed. Pass `--no-sdk-key` to skip this step.

## 0.1.1

### Patch Changes

- 0069345: Testing changeset npm publishing
