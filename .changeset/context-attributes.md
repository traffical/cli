---
"@traffical/cli": minor
---

Context attributes in `traffical.yaml` and typed context codegen.

- New top-level `attributes:` block (type, format, values, range, label,
  description, identifier, logging, breakdown, encoding). `push` syncs it first
  so policies pushed later validate against it; `pull` writes every active
  user-managed attribute; `status` reports drift; `--prune` archives synced
  attributes missing from the file and lists referenced ones as skipped.
- `generate-types` (and `pull --include-types`) emit `TrafficalContext` and
  `TrafficalAttributeKey` from the registry, so `decide(context, defaults)` can
  be typed at the call site. Degrades to a note when the project is not linked
  or the server predates the endpoint.
- Fix: `pull` no longer drops the `propertyGroups` block.
