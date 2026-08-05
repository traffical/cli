---
"@traffical/cli": minor
---

`traffical init` provisions a publishable key alongside the server key.

Init previously minted one key — a server SDK key — and the Svelte template it
scaffolded read it from `VITE_TRAFFICAL_API_KEY`. Vite inlines `VITE_*` into the
client bundle, so the CLI's own happy path shipped a secret key to the browser.
That key grants access to the project's full ruleset.

`init` now mints a pair and writes both to `.traffical/.env`:

| Variable | Key | Belongs |
|---|---|---|
| `TRAFFICAL_API_KEY` | `traffical_sk_…` | server only |
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
