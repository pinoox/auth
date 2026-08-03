import { createLogger, type AuthLogger } from './logger';
import { resolveConfig, type CreateAuthOptions } from './resolveConfig';
import { createStorage, type TokenStorage } from './storage';
import { jwtMatchesAuthKey } from './jwt';
import { extractTokenAndUser, localLogin } from '../strategies/local';
import { buildRemoteLoginUrl, redirectToRemoteLogin } from '../strategies/remote';
import { createFetchProvider, type HttpClient } from '../http/types';
import {
  redirectToReturn,
  resolveReturnPath,
  toAbsoluteReturnUrl,
  loginBlockedPrefixes,
} from './returnPath';
import type {
  AuthEvent,
  AuthEventHandler,
  AuthRequestAuth,
  AuthUser,
  LoginCredentials,
  LoginResult,
  ResolvedAuthConfig,
} from './types';

export type { AuthUser, LoginCredentials, LoginResult, AuthEvent, AuthEventHandler, AuthRequestAuth };

export interface AuthInstance {
  readonly config: ResolvedAuthConfig;
  readonly logger: AuthLogger;
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (credentials?: LoginCredentials) => Promise<LoginResult | void>;
  logout: () => Promise<void>;
  me: () => Promise<AuthUser | null>;
  getToken: () => string | null;
  setToken: (token: string | null) => void;
  clearToken: () => void;
  getAuthHeader: () => string | null;
  authorize: (headers?: Record<string, string>) => AuthRequestAuth & { headers: Record<string, string> };
  getRequestAuth: () => AuthRequestAuth;
  setHttp: (client: HttpClient) => void;
  loginFromResponse: (payload: unknown) => LoginResult;
  redirectToLogin: (returnPath?: string) => void;
  /** Safe path from ?redirect= (or query object). */
  getReturnPath: (queryOrPath?: unknown, fallback?: string) => string;
  /** Absolute return URL (uses SITE origin when Vite origin differs). */
  getReturnUrl: (queryOrPath?: unknown, fallback?: string) => string;
  /** Navigate to post-login return URL. */
  redirectBack: (queryOrPath?: unknown, fallback?: string) => void;
  /** `{ redirect }` for router-link query preservation. */
  getRedirectQuery: (queryOrPath?: unknown, fallback?: string) => { redirect: string };
  /** Clear session and emit `unauthorized` (e.g. from HTTP 401). */
  notifyUnauthorized: (payload?: unknown) => void;
  on: (event: AuthEvent, handler: AuthEventHandler) => () => void;
  off: (event: AuthEvent, handler: AuthEventHandler) => void;
}

export interface CreateAuthConfig extends CreateAuthOptions {
  http?: HttpClient;
  logger?: AuthLogger;
}

let defaultInstance: AuthInstance | null = null;

export function getAuth(): AuthInstance {
  if (!defaultInstance) {
    throw new Error('@pinooxhq/auth: call createAuth() before getAuth()');
  }

  return defaultInstance;
}

export function createAuth(options: CreateAuthConfig = {}): AuthInstance {
  const logger = options.logger ?? createLogger(options.debug);
  const config = resolveConfig(options, logger);
  const storage = createStorage(config.key, logger);
  let http: HttpClient = options.http ?? createFetchProvider();

  let token: string | null = storage.get();
  let user: AuthUser | null = null;
  let authenticated = false;

  const listeners = new Map<AuthEvent, Set<AuthEventHandler>>();

  const emit = (event: AuthEvent, payload?: unknown): void => {
    const set = listeners.get(event);

    if (!set) {
      return;
    }

    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        logger.error('error', 'Event handler failed', { event, error: String(error) });
      }
    }
  };

  const syncToken = (value: string | null): void => {
    token = value;
    storage.set(value);
  };

  const resolveToken = (): string | null => {
    const current = token ?? storage.get();
    if (!current) {
      return null;
    }

    if (config.mode === 'jwt' && config.key && !jwtMatchesAuthKey(current, config.key)) {
      logger.warn('mismatch.key', 'In-memory JWT claim does not match auth.key — recovering', {
        key: config.key,
      });
      // Clear memory + bad localStorage only; keep cookie so storage.get() can recover.
      token = null;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(config.key);
        }
      } catch {
        // ignore
      }
      return storage.get();
    }

    return current;
  };

  const getAuthHeader = (): string | null => {
    if (config.mode !== 'jwt') {
      return null;
    }

    const current = resolveToken();
    if (!current) {
      return null;
    }

    return current.toLowerCase().startsWith('bearer ') ? current : `Bearer ${current}`;
  };

  const getRequestAuth = (): AuthRequestAuth => ({
    header: getAuthHeader(),
    credentials: 'include',
    mode: config.mode,
    key: config.key,
  });

  const authorize = (headers: Record<string, string> = {}): AuthRequestAuth & { headers: Record<string, string> } => {
    const auth = getRequestAuth();
    const next = { ...headers };

    if (auth.header) {
      next.Authorization = auth.header;
    }

    logger.debug('request.auth', 'Authorized request headers', {
      mode: auth.mode,
      hasHeader: !!auth.header,
    });

    return { ...auth, headers: next };
  };

  const withAuthHeaders = (headers: Record<string, string> = {}): Record<string, string> => {
    return authorize(headers).headers;
  };

  const loginFromResponse = (payload: unknown): LoginResult => {
    const extracted = extractTokenAndUser(payload);

    if (config.mode === 'jwt' && !extracted.token) {
      logger.warn('mismatch.mode', 'JWT mode expected token in response but none found', {
        mode: config.mode,
      });
      emit('mismatch', { code: 'mismatch.mode', payload });
    }

    if (extracted.token) {
      syncToken(extracted.token);
    }

    if (extracted.user) {
      user = extracted.user;
    }

    authenticated = !!(extracted.token || config.mode !== 'jwt');
    emit('login', { token: extracted.token, user: extracted.user });

    return { ...extracted, raw: payload };
  };

  const me = async (): Promise<AuthUser | null> => {
    // Prefer stored/dev JWT, but never skip the request — HttpOnly server
    // cookies authenticate via credentials: 'include' without readable storage.
    token = resolveToken();

    try {
      const response = await http.request({
        url: config.endpoints.me,
        method: 'GET',
        credentials: 'include',
        headers: withAuthHeaders({
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        }),
      });

      if (response.status === 401) {
        syncToken(null);
        user = null;
        authenticated = false;
        logger.warn('session.unauthorized', 'Session validation returned 401', {
          url: config.endpoints.me,
        });
        emit('unauthorized', { status: 401 });
        return null;
      }

      if (!response.ok) {
        logger.error('error', 'me() request failed', { status: response.status });
        emit('error', { status: response.status, data: response.data });
        return null;
      }

      const extracted = extractTokenAndUser(response.data);

      if (extracted.token) {
        syncToken(extracted.token);
      }

      user = extracted.user ?? (response.data as AuthUser);
      authenticated = true;
      logger.info('session.ok', 'Session validated', {
        hasUser: !!user,
        hasToken: !!resolveToken(),
        viaCookie: !extracted.token && !token,
      });
      return user;
    } catch (error) {
      logger.error('error', 'me() threw', { error: String(error) });
      emit('error', error);
      return null;
    }
  };

  const login = async (credentials?: LoginCredentials): Promise<LoginResult | void> => {
    if (config.strategy === 'remote') {
      redirectToRemoteLogin(config, undefined, logger);
      return;
    }

    if (!credentials?.password) {
      throw new Error('@pinooxhq/auth: login() requires credentials for local strategy');
    }

    const result = await localLogin(config, http, storage, credentials, logger);
    token = result.token ?? storage.get();
    user = result.user;
    authenticated = !!(result.token || config.mode !== 'jwt');
    emit('login', result);
    return result;
  };

  const logout = async (): Promise<void> => {
    try {
      await http.request({
        url: config.endpoints.logout,
        method: 'GET',
        credentials: 'include',
        headers: withAuthHeaders({
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        }),
      });
    } catch (error) {
      logger.warn('error', 'Remote logout failed; clearing local session anyway', {
        error: String(error),
      });
    }

    syncToken(null);
    user = null;
    authenticated = false;
    emit('logout');
    logger.info('token.cleared', 'Logged out');
  };

  const instance: AuthInstance = {
    config,
    logger,
    get user() {
      return user;
    },
    set user(value) {
      user = value;
    },
    get token() {
      return resolveToken();
    },
    set token(value) {
      syncToken(value);
    },
    get isAuthenticated() {
      // JWT may live only in an HttpOnly cookie (readable by me()/API via
      // credentials). In that case `authenticated` is set after a successful me().
      if (config.mode === 'jwt') {
        return authenticated || !!resolveToken();
      }
      return authenticated;
    },
    set isAuthenticated(value) {
      authenticated = value;
    },
    login,
    logout,
    me,
    getToken: () => resolveToken(),
    setToken: (value) => {
      syncToken(value);
    },
    clearToken: () => {
      syncToken(null);
      authenticated = false;
    },
    getAuthHeader,
    authorize,
    getRequestAuth,
    setHttp: (client) => {
      http = client;
    },
    loginFromResponse,
    redirectToLogin: (returnPath) => {
      if (config.strategy === 'remote') {
        redirectToRemoteLogin(config, returnPath, logger);
        return;
      }

      if (typeof window === 'undefined') {
        return;
      }

      const loginUrl = config.loginUrl ?? '/login';
      const loginPath = loginUrl.split('?')[0] || '/login';
      const candidate =
        returnPath
        ?? `${window.location.pathname}${window.location.search}`;
      // Block only login itself (loop); allow in-app return paths.
      const redirect = resolveReturnPath(candidate, '/', loginBlockedPrefixes(config));
      const url =
        redirect && redirect !== loginPath
          ? `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}redirect=${encodeURIComponent(redirect)}`
          : loginUrl;

      logger.info('redirect.login', 'Redirecting to login', { url });
      window.location.href = url;
    },
    getReturnPath: (queryOrPath, fallback = '/') => {
      const blocked = loginBlockedPrefixes(config);
      return resolveReturnPath(queryOrPath, fallback, blocked);
    },
    getReturnUrl: (queryOrPath, fallback = '/') => {
      const blocked = loginBlockedPrefixes(config);
      const path = resolveReturnPath(queryOrPath, fallback, blocked);
      return toAbsoluteReturnUrl(path, config.siteOrigin);
    },
    redirectBack: (queryOrPath, fallback = '/') => {
      const blocked = loginBlockedPrefixes(config);
      logger.info('redirect.back', 'Redirecting after auth', { queryOrPath, fallback });
      redirectToReturn(queryOrPath, {
        fallback,
        siteOrigin: config.siteOrigin,
        blockedPrefixes: blocked,
      });
    },
    getRedirectQuery: (queryOrPath, fallback = '/') => {
      const blocked = loginBlockedPrefixes(config);
      return { redirect: resolveReturnPath(queryOrPath, fallback, blocked) };
    },
    notifyUnauthorized: (payload) => {
      syncToken(null);
      user = null;
      authenticated = false;
      logger.warn('session.unauthorized', 'Unauthorized notified', {
        payload: payload ? String(payload) : undefined,
      });
      emit('unauthorized', payload ?? { status: 401 });
    },
    on: (event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }

      listeners.get(event)!.add(handler);

      return () => {
        listeners.get(event)?.delete(handler);
      };
    },
    off: (event, handler) => {
      listeners.get(event)?.delete(handler);
    },
  };

  defaultInstance = instance;
  emit('config', config);

  return instance;
}

export function buildLoginRedirectUrl(returnPath?: string): string {
  const auth = getAuth();
  return buildRemoteLoginUrl(auth.config, returnPath, auth.logger);
}

export {
  isSafeReturnPath,
  resolveReturnPath,
  resolveSiteOrigin,
  toAbsoluteReturnUrl,
  redirectToReturn,
} from './returnPath';

export type { CreateAuthOptions };
export type { TokenStorage };
