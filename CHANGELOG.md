# @traffical/cli

## 0.6.0

### Minor Changes

- d3d84ec: Auto-create project-scoped SDK key on init

  `traffical init` now automatically creates a project-scoped SDK key (sdk:read, sdk:write) via the Management API and saves it to `.traffical/.env`. A `.traffical/.gitignore` is also created to ensure the key is never committed. Pass `--no-sdk-key` to skip this step.

- d3d84ec: Simplify AI agent integration, rely on installable skill

  - Slim down generated AGENTS.md to project-specific quick reference with pointers to TEMPLATES.md and the installable skill (`npx skills add traffical/skills`)
  - Remove Claude-specific SKILL.md generation from `init` (replaced by the installable skill at `traffical/skills`)
  - Remove `integrate-ai-tools` command (replaced by the installable skill)
  - Add skill installation hint to `init` output

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
