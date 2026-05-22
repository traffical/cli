/**
 * Token Store
 *
 * Persists the device-flow session ({access_token, refresh_token, …}) in
 * ~/.config/traffical/auth.json with mode 0600. Writes are atomic. Reads
 * refuse files with overly permissive modes.
 *
 * Concurrent refreshes are serialized via a simple mkdir-based file lock
 * (see acquireLock / releaseLock). This is enough to make two concurrent
 * `traffical sync` invocations cooperate without racing the refresh.
 */

import { readFile, writeFile, mkdir, rename, chmod, stat, rm } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join, dirname } from "path";
import { randomBytes } from "crypto";
import type { AuthSession } from "./types.ts";

const CONFIG_DIR = ".config/traffical";
const AUTH_FILENAME = "auth.json";
const LOCK_DIRNAME = ".auth.lock";
const LOCK_STALE_MS = 30_000;

/** Path to ~/.config/traffical/ */
export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

/** Path to ~/.config/traffical/auth.json */
export function getAuthPath(): string {
  return join(getConfigDir(), AUTH_FILENAME);
}

/**
 * Read the auth session from disk. Returns null if file is missing,
 * malformed, or has unsafe permissions.
 */
export async function readSession(): Promise<AuthSession | null> {
  const path = getAuthPath();
  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }

  // Refuse to read if mode is world- or group-readable (POSIX only;
  // on Windows the mode bits are not meaningful and we just skip the check).
  if (process.platform !== "win32") {
    const mode = info.mode & 0o777;
    if (mode & 0o077) {
      throw new Error(
        `Refusing to read ${path}: permissions are too open (${mode.toString(8)}). ` +
          `Run: chmod 600 ${path}`
      );
    }
  }

  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content) as AuthSession;
    if (!parsed.access_token || !parsed.refresh_token || !parsed.user_email) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the auth session to disk atomically with mode 0600.
 */
export async function writeSession(session: AuthSession): Promise<void> {
  const path = getAuthPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  const tmpPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmpPath, JSON.stringify(session, null, 2), { encoding: "utf-8", mode: 0o600 });
  // Ensure mode even if umask interfered
  if (process.platform !== "win32") {
    await chmod(tmpPath, 0o600);
  }
  await rename(tmpPath, path);
}

/** Delete the auth session. Returns true if a file was removed. */
export async function deleteSession(): Promise<boolean> {
  try {
    await rm(getAuthPath());
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// File lock (mkdir-based — atomic on every POSIX filesystem and on Windows)
// ============================================================================

function getLockPath(): string {
  // Per-user lock dir under tmpdir to survive home-on-NFS edge cases.
  return join(tmpdir(), `traffical-${process.getuid?.() ?? "user"}`, LOCK_DIRNAME);
}

async function isStale(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Try to acquire the auth lock. Returns true on success, false if held.
 * Stale locks (older than LOCK_STALE_MS) are reclaimed.
 */
export async function acquireLock(): Promise<boolean> {
  const lockPath = getLockPath();
  await mkdir(dirname(lockPath), { recursive: true });

  try {
    await mkdir(lockPath); // atomic; fails if exists
    return true;
  } catch {
    if (await isStale(lockPath)) {
      try {
        await rm(lockPath, { recursive: true, force: true });
        await mkdir(lockPath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export async function releaseLock(): Promise<void> {
  try {
    await rm(getLockPath(), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Wait up to `timeoutMs` for the lock to become available, then run fn().
 * Polls at `pollMs` intervals.
 */
export async function withLock<T>(
  fn: () => Promise<T>,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (await acquireLock()) {
      try {
        return await fn();
      } finally {
        await releaseLock();
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for auth lock at ${getLockPath()}. ` +
          `If no other traffical process is running, remove the lock manually.`
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Mask a token for safe display. Keeps first 12 chars + "…". */
export function redactToken(token: string | undefined | null): string {
  if (!token) return "<none>";
  if (token.length <= 12) return "***";
  return `${token.slice(0, 12)}…`;
}
