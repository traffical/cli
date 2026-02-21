---
"@traffical/cli": minor
---

Simplify AI agent integration, rely on installable skill

- Slim down generated AGENTS.md to project-specific quick reference with pointers to TEMPLATES.md and the installable skill (`npx skills add traffical/skills`)
- Remove Claude-specific SKILL.md generation from `init` (replaced by the installable skill at `traffical/skills`)
- Remove `integrate-ai-tools` command (replaced by the installable skill)
- Add skill installation hint to `init` output
