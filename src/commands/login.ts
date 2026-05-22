/**
 * login command
 *
 * OAuth 2.0 Device Authorization Grant (RFC 8628) against the Traffical
 * control plane (which proxies WorkOS). On success, persists the session
 * to ~/.config/traffical/auth.json.
 */

import chalk from "chalk";
import { exec } from "child_process";
import { writeSession } from "../lib/token-store.ts";
import { getApiBase } from "../lib/auth.ts";
import { ApiClient, AuthError, NetworkError } from "../lib/api.ts";
import { parseFormatOption } from "../lib/output.ts";
import type { AuthSession } from "../lib/types.ts";

export interface LoginOptions {
  apiBase?: string;
  /** Skip browser open; just print the URL+code. */
  noBrowser?: boolean;
  /** Bypass the device flow and seed the session with a provided JWT. */
  token?: string;
  format?: string | boolean;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenSuccess {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: { email: string };
}

interface DeviceTokenError {
  error: string;
  error_description?: string;
}

type DeviceTokenResponse = DeviceTokenSuccess | DeviceTokenError;

function isError(r: DeviceTokenResponse): r is DeviceTokenError {
  return typeof (r as DeviceTokenError).error === "string";
}

/** Best-effort browser open. Never throws. */
function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open ${JSON.stringify(url)}`
      : process.platform === "win32"
        ? `start "" ${JSON.stringify(url)}`
        : `xdg-open ${JSON.stringify(url)}`;
  exec(cmd, () => { /* ignore */ });
}

async function requestDeviceCode(apiBase: string): Promise<DeviceCodeResponse> {
  const resp = await fetch(`${apiBase}/v1/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!resp.ok) {
    throw new NetworkError(`Device code request failed: HTTP ${resp.status}`);
  }
  return resp.json() as Promise<DeviceCodeResponse>;
}

async function pollForToken(
  apiBase: string,
  deviceCode: string
): Promise<DeviceTokenResponse> {
  const resp = await fetch(`${apiBase}/v1/auth/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });
  if (!resp.ok) {
    return { error: "invalid_request", error_description: `HTTP ${resp.status}` };
  }
  return resp.json() as Promise<DeviceTokenResponse>;
}

export interface LoginResult {
  success: boolean;
  user_email: string;
  expires_at: number;
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  const format = parseFormatOption(options.format);
  const isJson = format === "json";
  const apiBase = await getApiBase(undefined, options.apiBase);

  // --token shortcut: seed the session with a provided JWT (CI/agent use).
  if (options.token) {
    // We have no refresh_token in this mode; expires_at is unknown.
    // Force a /v1/auth/me round-trip to learn the user email and to fail
    // fast if the token is bad.
    const client = await ApiClient.create({ apiKey: options.token, apiBase });
    const me = await client.validateKey();
    if (!me.valid) {
      throw new AuthError("Provided --token is not valid");
    }
    const session: AuthSession = {
      access_token: options.token,
      refresh_token: "",
      expires_at: 0,
      user_email: me.email ?? "unknown",
    };
    await writeSession(session);
    const result: LoginResult = { success: true, user_email: session.user_email, expires_at: 0 };
    if (isJson) {
      console.log(JSON.stringify(result));
    } else {
      console.log(chalk.green(`✓ Logged in as ${session.user_email} (token mode — no refresh)`));
    }
    return;
  }

  // Device flow
  const code = await requestDeviceCode(apiBase);

  const verificationUrl = code.verification_uri_complete ?? code.verification_uri;

  if (isJson) {
    // In JSON mode we still need to wait for completion; emit a single line
    // up front so agents/CI can capture it.
    console.error(
      JSON.stringify({
        event: "device_code",
        verification_uri: code.verification_uri,
        verification_uri_complete: code.verification_uri_complete,
        user_code: code.user_code,
        expires_in: code.expires_in,
      })
    );
  } else {
    console.log();
    console.log(chalk.bold("Sign in to Traffical"));
    console.log();
    console.log(`  Open: ${chalk.cyan(verificationUrl)}`);
    if (code.verification_uri_complete && code.verification_uri_complete !== code.verification_uri) {
      console.log(`  Or visit ${chalk.cyan(code.verification_uri)} and enter code:`);
    } else {
      console.log(`  Enter code: ${chalk.bold(code.user_code)}`);
    }
    console.log();
    if (!options.noBrowser) {
      openInBrowser(verificationUrl);
      console.log(chalk.dim("Opened browser. Waiting for confirmation…"));
    } else {
      console.log(chalk.dim("Waiting for confirmation…"));
    }
  }

  // Poll
  const start = Date.now();
  const deadline = start + code.expires_in * 1000;
  let interval = Math.max(code.interval, 1) * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const resp = await pollForToken(apiBase, code.device_code);

    if (!isError(resp)) {
      const now = Math.floor(Date.now() / 1000);
      const session: AuthSession = {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token,
        expires_at: now + (resp.expires_in ?? 600),
        user_email: resp.user?.email ?? "unknown",
      };
      // If the token response didn't include the email, derive it from /v1/auth/me.
      if (!resp.user?.email) {
        try {
          const client = await ApiClient.create({ apiKey: resp.access_token, apiBase });
          const me = await client.validateKey();
          if (me.email) session.user_email = me.email;
        } catch { /* best-effort */ }
      }
      await writeSession(session);

      const result: LoginResult = {
        success: true,
        user_email: session.user_email,
        expires_at: session.expires_at,
      };
      if (isJson) {
        console.log(JSON.stringify(result));
      } else {
        console.log();
        console.log(chalk.green(`✓ Logged in as ${session.user_email}`));
        console.log(chalk.dim(`  Session saved to ~/.config/traffical/auth.json`));
      }
      return;
    }

    // Error responses
    if (resp.error === "authorization_pending") {
      continue;
    }
    if (resp.error === "slow_down") {
      interval += 5_000;
      continue;
    }
    if (resp.error === "access_denied") {
      throw new AuthError("Authentication was denied.");
    }
    if (resp.error === "expired_token") {
      throw new AuthError("Device code expired before authentication completed. Run 'traffical login' again.");
    }
    // Unknown error — bail
    throw new AuthError(
      `Authentication failed: ${resp.error}${resp.error_description ? ` (${resp.error_description})` : ""}`
    );
  }

  throw new AuthError("Timed out waiting for authentication. Run 'traffical login' again.");
}
