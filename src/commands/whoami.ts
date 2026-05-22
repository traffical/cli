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
import { EXIT_AUTH_ERROR } from "../lib/api.ts";

export interface WhoamiOptions {
  format?: string | boolean;
}

export interface WhoamiResult {
  authenticated: boolean;
  source: string;
  user_email?: string;
  expires_at?: number;
  token_preview: string;
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
  const identity = await getIdentity();
  const link = await resolveProject();

  const result: WhoamiResult = {
    authenticated: identity.source !== "none",
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

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (!result.authenticated) {
      console.log(chalk.yellow("Not logged in."));
      console.log(chalk.dim("  Run 'traffical login' to authenticate."));
    } else {
      console.log(chalk.bold(result.user_email ?? "(unknown user)"));
      console.log(chalk.dim(`  source: ${result.source}`));
      console.log(chalk.dim(`  token: ${result.token_preview}`));
      if (result.expires_at) {
        const date = new Date(result.expires_at * 1000).toISOString();
        console.log(chalk.dim(`  expires: ${date}`));
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
