# @traffical/cli

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
