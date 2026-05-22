/**
 * Authentication
 *
 * Resolves the bearer token sent to the Traffical control plane on every
 * CLI call. Three credential paths, in priority order:
 *
 *   1. TRAFFICAL_API_KEY env var           — org-scoped key (CI path, never refreshed)
 *   2. TRAFFICAL_API_TOKEN env var         — pre-minted JWT (CI/agent)
 *   3. ~/.config/traffical/auth.json       — device-flow session; auto-refreshes
 *   4. Legacy ~/.trafficalrc profile       — back-compat; printed deprecation
 *
 * Plus a per-command override via `--api-key`.
 *
 * Refresh is serialized via a file lock so concurrent invocations don't race.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join, dirname } from "path";
import { parse, stringify } from "yaml";
import {
  readSession,
  writeSession,
  withLock,
  redactToken,
} from "./token-store.ts";
import type { AuthSession, TrafficalRc, ProfileConfig } from "./types.ts";

const RC_FILENAME = ".trafficalrc";

export const ENV_API_KEY = "TRAFFICAL_API_KEY";
export const ENV_API_TOKEN = "TRAFFICAL_API_TOKEN";
export const ENV_API_BASE = "TRAFFICAL_API_BASE";

export const DEFAULT_API_BASE = "https://api.traffical.io";

/** True if any of the bypass env vars are set (skip device-flow refresh). */
export function hasEnvCredentials(): boolean {
  return Boolean(process.env[ENV_API_KEY] || process.env[ENV_API_TOKEN]);
}

let _legacyDeprecationLogged = false;
function logLegacyDeprecation(): void {
  if (_legacyDeprecationLogged) return;
  _legacyDeprecationLogged = true;
  process.stderr.write(
    `⚠ Using legacy ~/.trafficalrc — run 'traffical login' to migrate to the device-flow session.\n`
  );
}

// ============================================================================
// Legacy ~/.trafficalrc (kept for back-compat)
// ============================================================================

export function getRcPath(): string {
  return join(homedir(), RC_FILENAME);
}

export async function readRcFile(): Promise<TrafficalRc> {
  try {
    const content = await readFile(getRcPath(), "utf-8");
    const parsed = parse(content) as TrafficalRc;
    return {
      default_profile: parsed.default_profile,
      profiles: parsed.profiles || {},
    };
  } catch {
    return { profiles: {} };
  }
}

export async function writeRcFile(rc: TrafficalRc): Promise<void> {
  const rcPath = getRcPath();
  await mkdir(dirname(rcPath), { recursive: true });
  const header = `# Traffical CLI legacy profile config.
# Prefer ~/.config/traffical/auth.json — managed by 'traffical login'.
# Do not commit this file.

`;
  const content = stringify(rc, { indent: 2 });
  await writeFile(rcPath, header + content, "utf-8");
}

export async function getProfile(profileName?: string): Promise<ProfileConfig | null> {
  const rc = await readRcFile();
  const name = profileName || rc.default_profile;
  if (!name) return null;
  return rc.profiles[name] || null;
}

export async function setProfile(name: string, config: ProfileConfig): Promise<void> {
  const rc = await readRcFile();
  rc.profiles[name] = config;
  if (!rc.default_profile) rc.default_profile = name;
  await writeRcFile(rc);
}

export async function listProfiles(): Promise<{ name: string; isDefault: boolean }[]> {
  const rc = await readRcFile();
  return Object.keys(rc.profiles).map((name) => ({
    name,
    isDefault: name === rc.default_profile,
  }));
}

export async function deleteProfile(name: string): Promise<boolean> {
  const rc = await readRcFile();
  if (!rc.profiles[name]) return false;
  delete rc.profiles[name];
  if (rc.default_profile === name) {
    rc.default_profile = Object.keys(rc.profiles)[0] || undefined;
  }
  await writeRcFile(rc);
  return true;
}

// ============================================================================
// API base resolution
// ============================================================================

export async function getApiBase(profileName?: string, apiBaseOverride?: string): Promise<string> {
  if (apiBaseOverride) return apiBaseOverride;
  if (process.env[ENV_API_BASE]) return process.env[ENV_API_BASE]!;

  const session = await readSession();
  if (session?.api_base) return session.api_base;

  const profile = await getProfile(profileName);
  if (profile?.api_base) return profile.api_base;

  return DEFAULT_API_BASE;
}

// ============================================================================
// Token resolution
// ============================================================================

/** Seconds of clock-skew slack before treating an access token as expired. */
const EXPIRY_SLACK_SEC = 30;

function isAccessTokenFresh(session: AuthSession): boolean {
  const now = Math.floor(Date.now() / 1000);
  return session.expires_at > now + EXPIRY_SLACK_SEC;
}

/**
 * Refresh the access token via the control-plane proxy.
 * Caller is expected to hold the auth lock.
 */
async function refreshAccessToken(session: AuthSession, apiBase: string): Promise<AuthSession> {
  const resp = await fetch(`${apiBase}/v1/auth/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  if (!resp.ok) {
    throw new Error(`Token refresh failed: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as
    | { access_token: string; refresh_token?: string; expires_in?: number }
    | { error: string; error_description?: string };

  if ("error" in data) {
    throw new Error(`Token refresh failed: ${data.error}${data.error_description ? ` — ${data.error_description}` : ""}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const updated: AuthSession = {
    ...session,
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? session.refresh_token,
    expires_at: now + (data.expires_in ?? 600),
  };
  await writeSession(updated);
  return updated;
}

/**
 * Get the bearer token to send to the API.
 *
 * Throws a descriptive Error if no credential can be resolved. The caller
 * (typically the api client) is responsible for mapping that to an AuthError
 * with exit code 2.
 */
export async function getAccessToken(options: {
  profile?: string;
  apiKey?: string;
  apiBase?: string;
} = {}): Promise<string> {
  // 1. Explicit --api-key flag wins
  if (options.apiKey) return options.apiKey;

  // 2. Env var (CI: org-scoped key or pre-minted JWT)
  if (process.env[ENV_API_KEY]) return process.env[ENV_API_KEY]!;
  if (process.env[ENV_API_TOKEN]) return process.env[ENV_API_TOKEN]!;

  // 3. Device-flow session
  const session = await readSession();
  if (session) {
    if (isAccessTokenFresh(session)) {
      return session.access_token;
    }
    // Refresh under lock — re-check after acquiring in case another process did it.
    const apiBase = await getApiBase(options.profile, options.apiBase);
    const refreshed = await withLock(async () => {
      const fresh = await readSession();
      if (fresh && isAccessTokenFresh(fresh)) return fresh;
      return refreshAccessToken(fresh ?? session, apiBase);
    });
    return refreshed.access_token;
  }

  // 4. Legacy ~/.trafficalrc profile (deprecated)
  const profile = await getProfile(options.profile);
  if (profile?.api_key) {
    logLegacyDeprecation();
    return profile.api_key;
  }

  throw new Error(
    `Not authenticated. Run 'traffical login' to authenticate, ` +
      `or set ${ENV_API_KEY} (CI) / ${ENV_API_TOKEN}.`
  );
}

/**
 * Identity summary for `whoami` and similar.
 */
export interface IdentitySummary {
  source: "env-api-key" | "env-api-token" | "session" | "legacy-profile" | "none";
  user_email?: string;
  expires_at?: number;
  token_preview: string;
}

export async function getIdentity(options: { profile?: string } = {}): Promise<IdentitySummary> {
  if (process.env[ENV_API_KEY]) {
    return { source: "env-api-key", token_preview: redactToken(process.env[ENV_API_KEY]) };
  }
  if (process.env[ENV_API_TOKEN]) {
    return { source: "env-api-token", token_preview: redactToken(process.env[ENV_API_TOKEN]) };
  }
  const session = await readSession();
  if (session) {
    return {
      source: "session",
      user_email: session.user_email,
      expires_at: session.expires_at,
      token_preview: redactToken(session.access_token),
    };
  }
  const profile = await getProfile(options.profile);
  if (profile?.api_key) {
    return { source: "legacy-profile", token_preview: redactToken(profile.api_key) };
  }
  return { source: "none", token_preview: "<none>" };
}
