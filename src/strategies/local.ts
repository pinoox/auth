import type { AuthLogger } from '../core/logger';
import type { AuthUser, LoginCredentials, LoginResult } from '../core/types';
import type { HttpClient } from '../http/types';
import type { ResolvedAuthConfig } from '../core/types';
import type { TokenStorage } from '../core/storage';

function unwrapPayload(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const record = data as Record<string, unknown>;

  if (record.data && typeof record.data === 'object') {
    return record.data as Record<string, unknown>;
  }

  return record;
}

export function extractTokenAndUser(payload: unknown): { token: string | null; user: AuthUser | null } {
  const data = unwrapPayload(payload);

  const tokenCandidate =
    (typeof data.token === 'string' && data.token)
    || (typeof (payload as { token?: string })?.token === 'string' && (payload as { token: string }).token)
    || null;

  const nestedUser = data.user && typeof data.user === 'object' ? (data.user as AuthUser) : null;
  const flatUser =
    (data.username || data.email || data.user_id || data.id || data.group_key)
      ? (data as AuthUser)
      : null;

  const userCandidate = nestedUser || flatUser;

  return {
    token: tokenCandidate,
    user: userCandidate,
  };
}

function extractErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;

  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code) {
      return code;
    }
  }

  if (typeof record.code === 'string' && record.code) {
    return record.code;
  }

  return null;
}

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  if (typeof record.message === 'string') {
    return record.message;
  }

  return '';
}

function isAlreadyAuthenticated(payload: unknown, status: number): boolean {
  const code = extractErrorCode(payload);
  if (code === 'ALREADY_AUTHENTICATED') {
    return true;
  }

  const message = extractErrorMessage(payload);
  if (/already\s+logged\s+in/i.test(message)) {
    return true;
  }

  // Some older controllers return a lang key
  if (status === 401 && /already_logged_in/i.test(JSON.stringify(payload ?? {}))) {
    return true;
  }

  return false;
}

async function postLogin(
  config: ResolvedAuthConfig,
  http: HttpClient,
  credentials: LoginCredentials,
) {
  return http.request({
    url: config.endpoints.login,
    method: 'POST',
    body: credentials,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
}

/**
 * Clear a stuck HttpOnly server session so a fresh login can issue a JWT
 * the SPA can store (localStorage / Authorization header).
 */
async function clearServerSession(
  config: ResolvedAuthConfig,
  http: HttpClient,
  storage: TokenStorage,
  logger?: AuthLogger,
): Promise<void> {
  try {
    await http.request({
      url: config.endpoints.logout,
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
  } catch (error) {
    logger?.warn('error', 'Logout during already-authenticated recover failed', {
      error: String(error),
    });
  }

  storage.clear();
}

export async function localLogin(
  config: ResolvedAuthConfig,
  http: HttpClient,
  storage: TokenStorage,
  credentials: LoginCredentials,
  logger?: AuthLogger,
): Promise<LoginResult> {
  let response = await postLogin(config, http, credentials);

  // Server cookie still valid, SPA storage empty → login says "already logged in".
  // Clear the cookie session once, then retry with the submitted credentials.
  if (!response.ok && isAlreadyAuthenticated(response.data, response.status)) {
    logger?.info('session.recover', 'Already authenticated on server — clearing cookie and retrying login');
    await clearServerSession(config, http, storage, logger);
    response = await postLogin(config, http, credentials);
  }

  if (!response.ok) {
    logger?.error('session.unauthorized', 'Login request failed', {
      status: response.status,
      url: config.endpoints.login,
    });
    throw Object.assign(new Error('Login failed'), { status: response.status, data: response.data });
  }

  const { token, user } = extractTokenAndUser(response.data);

  if (config.mode === 'jwt' && !token) {
    logger?.warn('mismatch.mode', 'JWT mode expected token in login response but none found', {
      mode: config.mode,
      url: config.endpoints.login,
    });
  }

  if (token) {
    storage.set(token);
  }

  logger?.info('session.ok', 'Login succeeded', { hasToken: !!token, hasUser: !!user });

  return { token, user, raw: response.data };
}
