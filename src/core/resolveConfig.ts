import type { AuthMode, BootAuthConfig, PinooxBootstrap, ResolvedAuthConfig, AuthEndpoints, AuthStrategy } from './types';
import type { AuthLogger } from './logger';
import { resolveSiteOrigin } from './returnPath';

export interface CreateAuthOptions {
  mode?: AuthMode;
  key?: string;
  strategy?: AuthStrategy;
  loginUrl?: string;
  /** Prefix for relative endpoint paths (e.g. `/account/api/v1`). */
  baseUrl?: string | null;
  endpoints?: AuthEndpoints;
  apiBase?: string;
  /** Override site origin (defaults to __PINOOX__.url.SITE). */
  siteOrigin?: string | null;
  debug?: boolean;
  boot?: PinooxBootstrap | null;
}

function readBoot(): PinooxBootstrap {
  if (typeof globalThis === 'undefined') {
    return {};
  }

  const g = globalThis as typeof globalThis & {
    __PINOOX__?: PinooxBootstrap;
    PINOOX?: { URL?: PinooxBootstrap['url'] };
  };

  if (g.__PINOOX__ && typeof g.__PINOOX__ === 'object') {
    return g.__PINOOX__;
  }

  if (g.PINOOX?.URL) {
    return { url: g.PINOOX.URL };
  }

  return {};
}

function normalizeMode(value: unknown): AuthMode {
  const mode = String(value ?? 'jwt').toLowerCase();

  if (mode === 'cookie' || mode === 'session' || mode === 'jwt') {
    return mode;
  }

  return 'jwt';
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  let base = value.trim().replace(/\/$/, '');

  if (!/^https?:\/\//i.test(base) && !base.startsWith('/')) {
    base = `/${base}`;
  }

  return base;
}

/** Join base + relative path. Absolute http(s) or leading-/ paths pass through. */
export function joinUrl(base: string, path: string): string {
  if (!path) {
    return base;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (path.startsWith('/')) {
    return path;
  }

  const normalizedBase = base.replace(/\/$/, '');
  return `${normalizedBase}/${path.replace(/^\//, '')}`;
}

/**
 * Resolve an endpoint against optional baseUrl.
 * - absolute URL or site path (`/…`) → unchanged
 * - relative (`auth/get`) + baseUrl → joined
 * - relative without baseUrl → returned as-is (caller should prefer absolute defaults)
 */
export function resolveEndpoint(
  path: string | undefined,
  fallback: string,
  baseUrl?: string | null,
): string {
  const value = (typeof path === 'string' && path.trim() !== '' ? path.trim() : fallback);

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (baseUrl) {
    if (value.startsWith(baseUrl)) {
      return value;
    }
    return joinUrl(baseUrl, value);
  }

  return value;
}

function inferStrategy(bootAuth: BootAuthConfig | undefined, explicit?: AuthStrategy): AuthStrategy {
  if (explicit) {
    return normalizeStrategy(explicit) ?? explicit;
  }

  const fromBoot = normalizeStrategy(bootAuth?.strategy);
  if (fromBoot) {
    return fromBoot;
  }

  if (bootAuth?.source) {
    return 'remote';
  }

  return 'local';
}

/** Canonical: local | remote. Legacy: provider → local, consumer | external → remote. */
function normalizeStrategy(value: unknown): AuthStrategy | null {
  if (value === 'local' || value === 'provider') {
    return 'local';
  }

  if (value === 'remote' || value === 'consumer' || value === 'external') {
    return 'remote';
  }

  return null;
}

function defaultEndpoints(
  apiBase: string,
  strategy: AuthStrategy,
  baseUrl: string | null,
  bootAuth?: BootAuthConfig,
): Required<AuthEndpoints> {
  if (strategy === 'remote') {
    if (baseUrl) {
      return {
        login: 'auth/login',
        logout: 'auth/logout',
        me: 'auth/get',
      };
    }

    const isPlatform = bootAuth?.source === 'com_pinoox_manager' || bootAuth?.provider === 'platform';
    if (isPlatform) {
      return {
        login: '/manager/api/v1/auth/login',
        logout: '/manager/api/v1/auth/logout',
        me: '/manager/api/v1/auth/get',
      };
    }

    return {
      login: '/account/api/v1/auth/login',
      logout: '/account/api/v1/auth/logout',
      me: '/account/api/v1/auth/get',
    };
  }

  return {
    login: joinUrl(apiBase || '/', 'auth/login'),
    logout: joinUrl(apiBase || '/', 'auth/logout'),
    me: joinUrl(apiBase || '/', 'auth/get'),
  };
}

export function resolveConfig(options: CreateAuthOptions = {}, logger?: AuthLogger): ResolvedAuthConfig {
  const boot = options.boot ?? readBoot();
  const bootAuth = boot.auth ?? {};
  const apiBase = (options.apiBase ?? boot.url?.API ?? '').replace(/\/$/, '');
  const strategy = inferStrategy(bootAuth, options.strategy);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? bootAuth.baseUrl ?? null);
  const defaults = defaultEndpoints(apiBase || '/', strategy, baseUrl, bootAuth);
  const bootEndpoints = bootAuth.endpoints ?? {};

  const endpoints: Required<AuthEndpoints> = {
    login: resolveEndpoint(options.endpoints?.login ?? bootEndpoints.login, defaults.login, baseUrl),
    logout: resolveEndpoint(options.endpoints?.logout ?? bootEndpoints.logout, defaults.logout, baseUrl),
    me: resolveEndpoint(options.endpoints?.me ?? bootEndpoints.me, defaults.me, baseUrl),
  };

  const key = bootAuth.key || options.key || '';
  const mode = normalizeMode(bootAuth.mode || options.mode);
  const debug = options.debug ?? (typeof import.meta !== 'undefined' && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV);

  if (!boot.auth && !options.key && !options.mode) {
    logger?.warn('config.missing', 'No __PINOOX__.auth and no explicit mode/key overrides', {
      hasBoot: Object.keys(boot).length > 0,
    });
  }

  if (!key) {
    logger?.warn('config.missing', 'auth.key is empty — token storage will fail until key is provided', {
      bootAuth,
    });
  }

  const isPlatform = bootAuth.source === 'com_pinoox_manager' || bootAuth.provider === 'platform';
  const loginUrl =
    options.loginUrl
    ?? bootAuth.loginUrl
    ?? (strategy === 'remote' ? (isPlatform ? '/manager/login' : '/account/login') : null);

  const appPath =
    (typeof boot.url?.BASE === 'string' && boot.url.BASE)
    || (typeof boot.url?.APP === 'string' && boot.url.APP)
    || (apiBase.match(/^(\/[^/]+)/)?.[1] ?? null);

  const siteOrigin = resolveSiteOrigin(boot.url, options.siteOrigin);

  const resolved: ResolvedAuthConfig = {
    mode,
    key,
    provider: bootAuth.provider ?? null,
    source: bootAuth.source ?? null,
    strategy,
    loginUrl,
    baseUrl,
    endpoints,
    apiBase,
    siteOrigin,
    appPath,
    debug: !!debug,
  };

  logger?.debug('config.resolved', 'Auth config resolved', {
    mode: resolved.mode,
    key: resolved.key,
    provider: resolved.provider,
    source: resolved.source,
    strategy: resolved.strategy,
    baseUrl: resolved.baseUrl,
    endpoints: resolved.endpoints,
    siteOrigin: resolved.siteOrigin,
    appPath: resolved.appPath,
  });

  return resolved;
}
