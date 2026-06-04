/**
 * whoami command
 *
 * Shows the current identity: user email, active org, linked project, and
 * which credential source is in effect.
 */

import chalk from "chalk";
import { getIdentity } from "../lib/auth.ts";
import { resolveProject } from "../lib/config.ts";
import { parseFormatOption } from "../lib/output.ts";
import { ApiClient, EXIT_AUTH_ERROR } from "../lib/api.ts";

export interface WhoamiOptions {
  format?: string | boolean;
  profile?: string;
  apiBase?: string;
  /** Validate the session against the server instead of trusting the cached token. */
  verify?: boolean;
}

export interface WhoamiResult {
  authenticated: boolean;
  /**
   * Whether the session was checked against the server this run.
   * - `true`  → a live check ran and passed (`authenticated` is trustworthy)
   * - `false` → a live check ran and failed (session dead despite cached token)
   * - `null`  → no live check (pass --verify); `authenticated` is presence-only
   */
  verified: boolean | null;
  source: string;
  user_email?: string;
  expires_at?: number;
  token_preview: string;
  error?: string;
  linked_project?: {
    org_id: string;
    project_id: string;
    org_key?: string;
    project_key?: string;
    source: "project.yaml" | "config.yaml";
  };
}

export async function whoamiCommand(options: WhoamiOptions): Promise<void> {
  const isJson = parseFormatOption(options.format) === "json";
  const identity = await getIdentity({ profile: options.profile });
  const link = await resolveProject();

  const result: WhoamiResult = {
    authenticated: identity.source !== "none",
    verified: null,
    source: identity.source,
    user_email: identity.user_email,
    expires_at: identity.expires_at,
    token_preview: identity.token_preview,
    linked_project: link
      ? {
          org_id: link.orgId,
          project_id: link.projectId,
          org_key: link.orgKey,
          project_key: link.projectKey,
          source: link.source,
        }
      : undefined,
  };

  // --verify: exercise the credential against the server. This is the only
  // reliable auth check — the cached session can report authenticated:true
  // while the refresh token has already ended server-side.
  if (options.verify && result.authenticated) {
    try {
      const client = await ApiClient.create({
        profile: options.profile,
        apiBase: options.apiBase,
      });
      const check = await client.validateKey();
      if (check.valid) {
        result.verified = true;
        if (check.email) result.user_email = check.email; // server is authoritative
      } else {
        result.verified = false;
        result.authenticated = false;
        result.error = "Session is no longer valid — run 'traffical login'.";
      }
    } catch (err) {
      // e.g. refresh failed with invalid_grant ("Session has already ended").
      result.verified = false;
      result.authenticated = false;
      result.error = err instanceof Error ? err.message : String(err);
    }
  }

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (!result.authenticated) {
      console.log(chalk.yellow(options.verify ? "Session invalid." : "Not logged in."));
      if (result.error) console.log(chalk.dim(`  ${result.error}`));
      console.log(chalk.dim("  Run 'traffical login' to authenticate."));
    } else {
      console.log(chalk.bold(result.user_email ?? "(unknown user)"));
      console.log(chalk.dim(`  source: ${result.source}`));
      console.log(chalk.dim(`  token: ${result.token_preview}`));
      if (result.expires_at) {
        const date = new Date(result.expires_at * 1000).toISOString();
        console.log(chalk.dim(`  expires: ${date}`));
      }
      if (result.verified === true) {
        console.log(chalk.green("  ✓ verified against server"));
      } else {
        console.log(chalk.dim("  (cached session — run with --verify for a live check)"));
      }
    }
    if (result.linked_project) {
      console.log();
      console.log(chalk.bold("Linked project"));
      const lp = result.linked_project;
      console.log(`  org:     ${lp.org_key ?? lp.org_id}`);
      console.log(`  project: ${lp.project_key ?? lp.project_id}`);
      console.log(chalk.dim(`  (from .traffical/${lp.source})`));
    }
  }

  if (!result.authenticated) {
    process.exit(EXIT_AUTH_ERROR);
  }
}
