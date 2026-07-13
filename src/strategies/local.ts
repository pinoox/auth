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

  const userCandidate =
    (data.user && typeof data.user === 'object' ? (data.user as AuthUser) : null)
    || (data.username || data.email || data.user_id ? (data as AuthUser) : null);

  return {
    token: tokenCandidate,
    user: userCandidate,
  };
}

export async function localLogin(
  config: ResolvedAuthConfig,
  http: HttpClient,
  storage: TokenStorage,
  credentials: LoginCredentials,
  logger?: AuthLogger,
): Promise<LoginResult> {
  const response = await http.request({
    url: config.endpoints.login,
    method: 'POST',
    body: credentials,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

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
