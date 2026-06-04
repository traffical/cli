---
"@traffical/cli": minor
---

Make `whoami` trustworthy and `init` ambiguity errors actionable in one shot.

- `whoami --verify` validates the session against the server instead of trusting the cached token, so it can no longer report `authenticated: true` when the session has actually ended (exits `2` if the session is dead). Plain `whoami` now notes it is a cached, non-live check. JSON output gains a `verified` field (`true` | `false` | `null`).
- `init` ambiguity errors now name both `--org` and `--project` up front (instead of failing one axis per run) and attach the available orgs/projects as structured `details` in JSON output, so agents can resolve them without separate `org list` / `project list` calls.
