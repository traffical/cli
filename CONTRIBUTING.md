# Contributing to Traffical CLI

Thank you for your interest in contributing to the Traffical CLI!

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- Node.js 22+ (for compatibility testing)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/traffical/cli.git
   cd cli
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Build:
   ```bash
   bun run build
   ```

4. Run type checking:
   ```bash
   bun run typecheck
   ```

## Development Workflow

### Project Structure

This is a single-package repo for the `@traffical/cli`:

- `src/index.ts` - CLI entry point and command definitions
- `src/commands/` - Command implementations (`init`, `push`, `pull`, `sync`, `status`, `import`)
- `src/lib/api.ts` - HTTP client for the Traffical Control Plane API
- `src/lib/auth.ts` - API key resolution and `~/.trafficalrc` management
- `src/lib/config.ts` - Config file parsing (`.traffical/config.yaml`)
- `src/lib/types.ts` - Shared TypeScript types
- `src/lib/skill.ts` - Dynamic SKILL.md generation
- `src/lib/frameworks.ts` - Framework detection and SDK mapping
- `src/lib/ai-tools.ts` - AI tool config file integration

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Run type checking:
   ```bash
   bun run typecheck
   ```

4. Test locally:
   ```bash
   bun run dev -- <command> [options]
   ```

5. Document your changes:
   ```bash
   bunx changeset
   ```

   Follow the prompts to describe your changes. This creates a changeset file that will be used to generate changelogs and bump versions.

### Pull Request Process

1. Ensure type checking passes
2. Update documentation if needed
3. Include a changeset for user-facing changes
4. Submit a PR against the `main` branch

## Code Style

- Use TypeScript for all code
- Follow existing patterns in the codebase
- Keep functions small and focused
- Use the error classes from `src/lib/api.ts` (`ValidationError`, `AuthError`, `NetworkError`) for consistent exit codes

## Versioning & Releases

We use [Changesets](https://github.com/changesets/changesets) for version management.

**Do not manually edit version numbers in `package.json`.** Do not manually run `bunx changeset version` or `bunx changeset publish`. All version bumping and npm publishing is fully automated by GitHub Actions (see `.github/workflows/release.yml`).

### Version Types

- **patch**: Bug fixes, documentation updates
- **minor**: New features (backwards compatible)
- **major**: Breaking changes

### Creating a Changeset

Your only responsibility is to create a changeset that describes what changed. Run this after making your code changes:

```bash
bunx changeset
```

This will prompt you to:
1. Confirm `@traffical/cli` is affected
2. Choose the version bump type (patch/minor/major)
3. Write a summary of the changes

A markdown file will be created in `.changeset/` — commit this file alongside your code changes.

### Release Process (Fully Automated)

Releases are handled entirely by the GitHub Actions workflow in `.github/workflows/release.yml`. There are no manual steps. The process works as follows:

1. **You merge your PR to `main`** — Your PR includes code changes and a `.changeset/` file.
2. **GitHub Actions creates a "Version Packages" PR** — The `changesets/action` detects pending changesets and automatically opens a PR that bumps versions in `package.json` and updates the changelog.
3. **A maintainer reviews and merges the "Version Packages" PR** — This is the only review step.
4. **GitHub Actions publishes to npm** — When the "Version Packages" PR is merged to `main`, the workflow runs again. This time there are no pending changesets, so it runs `bun run release` which publishes the updated package to npm automatically.

That's it. Never run `npm publish` or `changeset publish` commands locally.

## Questions?

Open an issue or reach out to the maintainers.
