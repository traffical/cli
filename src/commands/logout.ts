/**
 * logout command
 *
 * Removes ~/.config/traffical/auth.json. Does not revoke the refresh token
 * server-side (no API for that yet — follow-up).
 */

import chalk from "chalk";
import { deleteSession } from "../lib/token-store.ts";
import { parseFormatOption } from "../lib/output.ts";

export interface LogoutOptions {
  format?: string | boolean;
}

export async function logoutCommand(options: LogoutOptions): Promise<void> {
  const isJson = parseFormatOption(options.format) === "json";
  const removed = await deleteSession();
  if (isJson) {
    console.log(JSON.stringify({ success: true, removed }));
  } else {
    if (removed) {
      console.log(chalk.green("✓ Logged out"));
    } else {
      console.log(chalk.dim("No active session"));
    }
  }
}
