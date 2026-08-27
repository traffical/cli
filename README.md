# @traffical/cli

Config-as-code CLI for Traffical — manage your feature flags and experimentation parameters in version-controlled YAML files. When you push a config via CLI, the remote parameters enter a **synced, read-only state** in the dashboard, ensuring version control remains the source of truth.

## Installation

```bash
# Install globally
npm install -g @traffical/cli

# Or use via npx
npx @traffical/cli init
```

## Quick Start

```bash
# One-time: authenticate (opens a browser via OAuth Device Flow)
traffical login

# In your repo: link to a project and scaffold .traffical/
traffical init

# Edit .traffical/config.yaml, then sync
traffical sync
```

`traffical init` runs `login` for you if you're not already authenticated,
picks (or creates) a project, writes `.traffical/project.yaml` (the link),
provisions a project-scoped SDK key into `.traffical/.env`, and scaffolds
framework-specific templates.

## What `init` creates

```
.traffical/
├── project.yaml   # repo → Traffical project link (commit this)
├── config.yaml    # parameters, events, property groups (commit this)
├── .env           # TRAFFICAL_API_KEY (server) + TRAFFICAL_PUBLISHABLE_KEY (client), gitignored
├── .gitignore     # auto-written: .env
├── AGENTS.md      # quick reference for AI coding tools (committed at repo root)
└── TEMPLATES.md   # framework-specific code patterns (commit this)
```

The CLI detects your framework (React, Next.js, Svelte, SvelteKit, Vue,
Nuxt, Node.js) and writes templates accordingly. Existing files are
preserved unless `--force` is passed.

## Commands

| Command | Description |
|---------|-------------|
| `login` | OAuth Device Flow authentication; persists session to `~/.config/traffical/auth.json` |
| `logout` | Remove the local session |
| `whoami` | Show active identity, linked project, token expiry |
| `init` | One-shot setup: login → link → scaffold (`.traffical/`, SDK key, AGENTS.md, templates) |
| `link` | Link the current repo to a project (writes `.traffical/project.yaml`) |
| `unlink` | Remove the project link |
| `org list \| use <key>` | List orgs you belong to / set the default org |
| `project list \| create <name> \| use <key>` | Manage projects in the active org |
| `push` | Push local config to Traffical (validates first) |
| `pull` | Pull synced parameters from Traffical to local config |
| `sync` | Bidirectional sync (local wins policy) |
| `status` | Show current sync status |
| `import <key>` | Import dashboard parameters (supports wildcards: `ui.*`, `*.enabled`) |
| `generate-types` | Generate TypeScript types from `config.yaml` |

### `init` Options

| Flag | Description |
|------|-------------|
| `--api-key <key>` | API key for authentication |
| `--framework <name>` | Skip framework detection (react, nextjs, svelte, sveltekit, node) |
| `--project <id>` | Project ID (skip interactive selection) |
| `--yes` | Accept all defaults without prompting |

The `init` command auto-detects your framework, scaffolds events, generates framework-specific code templates, and creates a project-scoped SDK key.

### `push` Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Validate and preview changes without applying |
| `--prune` | Archive orphaned synced parameters that no longer exist in your local config |

## Sync Behavior

The CLI uses a **"local wins"** policy for the `sync` command:

1. **Validates** your local config first (catches errors before any network calls)
2. **Pushes** your local parameters and events to Traffical (your edits take precedence)
3. **Adds** new parameters and events from Traffical that you don't have locally
4. **Warns** about conflicts (but your local version is used)

This matches the Git workflow where your local file is the source of truth. If you want to overwrite local changes with remote values, use `traffical pull` explicitly.

### Example Workflow

```bash
# Edit config locally
vim .traffical/config.yaml

# Sync: your changes are pushed, new remote params/events are added
traffical sync

# If you want remote values to overwrite local:
traffical pull
```

## Config File Format

Parameters are organized by **namespace**. The `main` namespace lives under the top-level `parameters:` key, while other namespaces are grouped under `namespaces:` using their **local key** (without the namespace prefix).

```yaml
# .traffical/config.yaml
version: "1.0"
project:
  id: proj_xxx
  orgId: org_xxx

# "main" namespace parameters (no prefix)
parameters:
  global_feature_enabled:
    type: boolean
    default: false
    description: Kill-switch for global feature

# Other namespaces — keys are local (prefix is implicit)
namespaces:
  checkout:
    parameters:
      button.color:           # full key: checkout.button.color
        type: string
        default: "#FF6600"
        description: Primary CTA button color
  catalog:
    parameters:
      ranking_algo:            # full key: catalog.ranking_algo
        type: string
        default: "default"
        description: Which ranking algorithm to use
        constraints:
          allowedValues: ["default", "popularity", "random"]
  pricing:
    parameters:
      discount.enabled:        # full key: pricing.discount.enabled
        type: boolean
        default: false

events:
  purchase:
    valueType: currency
    unit: USD
    description: User completes a purchase

  add_to_cart:
    valueType: count
    description: User adds item to cart
```

> **Backwards compatibility:** The flat format (all parameters under `parameters:` with an explicit `namespace` field) is still accepted on read. The CLI normalizes it internally. On write (`pull`/`sync`), the grouped format above is always produced.

### Parameter Types

| Type | Default Value |
|------|---------------|
| `string` | Any string |
| `number` | Any number |
| `boolean` | `true` or `false` |
| `json` | Object or array |

### Parameter Constraints

Parameters can have optional constraints that restrict their values. Constraints are synced to Traffical and shown in the dashboard UI.

```yaml
namespaces:
  catalog:
    parameters:
      ranking_algo:
        type: string
        default: "default"
        description: Which ranking algorithm to use
        constraints:
          allowedValues: ["default", "popularity", "random"]
  pricing:
    parameters:
      discount_pct:
        type: number
        default: 10
        constraints:
          min: 0
          max: 100
  checkout:
    parameters:
      promo_code:
        type: string
        default: ""
        constraints:
          pattern: "^[A-Z0-9]{4,10}$"
```

| Constraint | Applies To | Description |
|------------|-----------|-------------|
| `allowedValues` | `string`, `number` | Restrict to specific values (enum-like) |
| `min` | `number` | Minimum allowed value |
| `max` | `number` | Maximum allowed value |
| `pattern` | `string` | Regex pattern to validate values |

When `allowedValues` are set, the Traffical dashboard renders a dropdown selector instead of a free-text input for default values and policy overrides.

### Events

Events define the metrics you want to track for experimentation and analytics. They are synced to Traffical alongside your parameters.

```yaml
# .traffical/config.yaml
version: "1.0"
project:
  id: proj_xxx
  orgId: org_xxx

parameters:
  # ... main namespace parameters ...

namespaces:
  # ... other namespace parameters ...

events:
  purchase:
    valueType: currency
    unit: USD
    description: User completes a purchase

  add_to_cart:
    valueType: count
    description: User adds item to cart

  checkout_started:
    valueType: boolean
    description: User initiates checkout

  conversion_rate:
    valueType: rate
    unit: percent
    description: Percentage of visitors who convert
```

#### Event Value Types

| Value Type | Use Case | Example |
|------------|----------|---------|
| `currency` | Monetary values (revenue, order value) | Purchase amount in USD |
| `count` | Numeric counts (clicks, items, views) | Items added to cart |
| `rate` | Percentages or ratios | Conversion rate |
| `boolean` | Binary events (happened or not) | Checkout started |

#### Event Properties

| Property | Required | Description |
|----------|----------|-------------|
| `valueType` | Yes | Type of value: `currency`, `count`, `rate`, or `boolean` |
| `unit` | No | Unit for the value (e.g., `USD`, `items`, `percent`) |
| `description` | No | Human-readable description of what the event tracks |

## Validation

The CLI validates your config against a JSON Schema before pushing:

- Required fields (`version`, `project.id`, `project.orgId`)
- Type consistency (e.g., `type: boolean` must have a boolean `default`)
- ID format (`proj_*` and `org_*` prefixes)
- Event definitions (valid `valueType` values)

```bash
# Validation happens automatically on push/sync
traffical push

# Example error output
✗ Invalid config file

Errors:
  - parameters.my_flag.default: must be boolean
```

## AI Tool Integration

The CLI can automatically add Traffical references to AI coding tool configuration files:

```bash
# Scan and update AI tool files
traffical integrate-ai-tools

# Or auto-confirm without prompting
traffical integrate-ai-tools --yes
```

Supported files:
- `CLAUDE.md` (Claude Code)
- `.cursorrules` (Cursor)
- `.github/copilot-instructions.md` (GitHub Copilot)
- `.windsurfrules` (Windsurf)

This helps AI agents understand that your project uses Traffical and how to properly use feature flags and A/B tests.

## Global Options

```bash
-p, --profile <name>   # Use a specific profile from ~/.trafficalrc
-c, --config <path>    # Path to config file (default: .traffical/config.yaml)
-b, --api-base <url>   # API base URL (for self-hosted instances)
-j, --format <format>  # Output format: human (default) or json
-n, --dry-run          # Validate and preview changes without applying (push/sync)
```

## JSON Output

For scripting and CI/CD integration, use `--format json` to get machine-readable output:

```bash
# Get status as JSON
traffical status --format json

# Example output
{
  "project": { "id": "proj_xxx", "name": "My Project" },
  "org": { "id": "org_xxx", "name": "My Org" },
  "synced": [{ "key": "feature.enabled", "type": "boolean" }],
  "dashboardOnly": [],
  "localOnly": [],
  "hasDrift": false
}
```

## Credential paths

There are three ways the CLI gets a bearer token, in priority order:

| Path | When to use | How |
|------|-------------|-----|
| `--api-key <token>` flag | One-off override | Per-command flag |
| `TRAFFICAL_API_KEY` env | **CI** / org-scoped management | Long-lived org key, never refreshed |
| `TRAFFICAL_API_TOKEN` env | Headless agent with a pre-minted JWT | Skips the device flow |
| `~/.config/traffical/auth.json` | **Local dev** | Created by `traffical login`; auto-refreshes |
| `~/.trafficalrc` | Legacy | Migrated automatically; prints a deprecation notice |

For application runtime (your SDK calls in production), use the
project-scoped SDK key that `traffical init` provisions to `.traffical/.env`.

## Environment variables

| Variable | Description |
|----------|-------------|
| `TRAFFICAL_API_KEY` | Key the CLI authenticates with; takes precedence over the session. For CI this is a management key (`traffical_mk_…`) — the CLI writes control-plane entities, which a `pk`/`sk` key cannot do. Note `traffical init` also writes this name into `.traffical/.env`, there holding the **server SDK** key for your app runtime. |
| `TRAFFICAL_PUBLISHABLE_KEY` | Written by `traffical init` into `.traffical/.env`. The publishable key (`traffical_pk_…`) for client-facing code — this is the only one safe to expose through `PUBLIC_`/`NEXT_PUBLIC_`/`VITE_` variables. Not read by the CLI itself. |
| `TRAFFICAL_API_TOKEN` | Pre-minted WorkOS JWT (CI/agent); takes precedence over the session |
| `TRAFFICAL_API_BASE` | API base URL (optional, for self-hosted) |
| `TRAFFICAL_LOG=debug` | Verbose logging (tokens are always redacted) |

## Exit codes

For scripting, CI/CD, and AI-agent integration:

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Validation error (invalid config file) |
| `2` | Authentication error (not logged in / token invalid) |
| `3` | Network/API error |
| `4` | Not linked (no `.traffical/project.yaml`) |
| `10` | Config drift detected (status command) |
| `11` | Policy needs attention |

## JSON output and agent-friendly behavior

The CLI is designed for use from AI agents, MCP-style tooling, and CI:

- `--format json` on any command produces deterministic stdout output.
- Errors in JSON mode include `{ code, message, hint, exit_code }`.
- In non-TTY environments the CLI never prompts — pass `--yes` and the
  required flags (`--org`, `--project`), or run `traffical login` first.
- Human progress goes to stderr; machine output goes to stdout.
- Tokens are always redacted in logs and error messages.

## Profiles (legacy)

`~/.trafficalrc` is the legacy auth path. New installs use the device-flow
session at `~/.config/traffical/auth.json`. The legacy file is still read
for back-compat — run `traffical login` to migrate.

```yaml
# legacy ~/.trafficalrc — prefer `traffical login`
default_profile: default
profiles:
  default:
    api_key: traffical_mk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## CI/CD Integration

The CLI is designed for CI/CD pipelines. Use environment variables for credentials and `--dry-run` for validation.

### Sync on Merge to Main

**Use case:** Automatically push parameter changes to Traffical when code is merged to main. This ensures your production parameters stay in sync with your codebase.

```yaml
# .github/workflows/traffical-sync.yml
name: Sync Traffical Config

on:
  push:
    branches: [main]
    paths:
      - '.traffical/**'

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Traffical CLI
        run: npm install -g @traffical/cli
      
      - name: Push to Traffical
        run: traffical push
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY }}
```

### Validate on Pull Request

**Use case:** Catch configuration errors before they're merged. The `--dry-run` flag validates the config and shows what would change without actually modifying anything.

```yaml
# .github/workflows/traffical-validate.yml
name: Validate Traffical Config

on:
  pull_request:
    paths:
      - '.traffical/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Traffical CLI
        run: npm install -g @traffical/cli
      
      - name: Validate Config (Dry Run)
        run: traffical push --dry-run
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY }}
```

### Drift Detection with JSON Output

**Use case:** Detect when someone changes parameters directly in the Traffical dashboard without updating the config file. Use JSON output for easier parsing.

```yaml
# .github/workflows/traffical-drift.yml
name: Check Traffical Drift

on:
  schedule:
    - cron: '0 9 * * *'  # Daily at 9am UTC

jobs:
  check-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Traffical CLI
        run: npm install -g @traffical/cli
      
      - name: Check for Drift
        id: status
        run: |
          STATUS=$(traffical status --format json)
          echo "$STATUS"
          DRIFT=$(echo "$STATUS" | jq '.hasDrift')
          echo "drift=$DRIFT" >> $GITHUB_OUTPUT
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY }}
      
      - name: Create Issue on Drift
        if: steps.status.outputs.drift == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '⚠️ Traffical config drift detected',
              body: 'Parameters exist locally that are not synced to Traffical.\n\nRun `traffical status` locally to see details, then run `traffical push` to sync.'
            })
```

### Environment-Specific Deploys

**Use case:** Deploy different parameter configurations to staging and production environments, each with their own Traffical project.

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main, staging]

jobs:
  sync-traffical:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Traffical CLI
        run: npm install -g @traffical/cli
      
      - name: Sync to Staging
        if: github.ref == 'refs/heads/staging'
        run: traffical push
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY_STAGING }}
      
      - name: Sync to Production
        if: github.ref == 'refs/heads/main'
        run: traffical push
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY_PROD }}
```

## Learn More

- [Config-as-Code Documentation](https://docs.traffical.io/config-as-code)
- [Parameter Schema Reference](https://docs.traffical.io/config-as-code/schema)
