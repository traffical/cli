/**
 * org list / org use
 *
 * `org list` shows orgs the user belongs to.
 * `org use <key>` updates default_org_key in ~/.config/traffical/auth.json
 * so the CLI knows which org to default to when the cwd isn't linked.
 */

import chalk from "chalk";
import { ApiClient, ValidationError } from "../lib/api.ts";
import { readSession, writeSession } from "../lib/token-store.ts";
import { parseFormatOption } from "../lib/output.ts";

export interface OrgListOptions {
  profile?: string;
  apiBase?: string;
  format?: string | boolean;
}

export async function orgListCommand(options: OrgListOptions): Promise<void> {
  const isJson = parseFormatOption(options.format) === "json";
  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });
  const orgs = await client.listOrganizations();
  const session = await readSession();

  if (isJson) {
    console.log(
      JSON.stringify(
        {
          default_org_key: session?.default_org_key,
          organizations: orgs.map((o) => ({ id: o.id, key: o.key, name: o.name })),
        },
        null,
        2
      )
    );
    return;
  }

  if (orgs.length === 0) {
    console.log(chalk.dim("No organizations available."));
    return;
  }
  for (const o of orgs) {
    const marker = session?.default_org_key === o.key ? chalk.green("* ") : "  ";
    console.log(`${marker}${o.key.padEnd(20)} ${chalk.dim(o.name)}`);
  }
}

export interface OrgUseOptions {
  key: string;
  profile?: string;
  apiBase?: string;
  format?: string | boolean;
}

export async function orgUseCommand(options: OrgUseOptions): Promise<void> {
  const isJson = parseFormatOption(options.format) === "json";
  const session = await readSession();
  if (!session) {
    throw new ValidationError("Not logged in. Run 'traffical login' first.");
  }
  // Validate the key actually exists for this user
  const client = await ApiClient.create({ profile: options.profile, apiBase: options.apiBase });
  const orgs = await client.listOrganizations();
  const match = orgs.find((o) => o.key === options.key || o.id === options.key);
  if (!match) {
    throw new ValidationError(`No organization with key or id "${options.key}"`);
  }

  await writeSession({ ...session, default_org_key: match.key });

  if (isJson) {
    console.log(JSON.stringify({ success: true, default_org_key: match.key, name: match.name }));
  } else {
    console.log(chalk.green(`✓ Default organization set to ${match.name} (${match.key})`));
  }
}
