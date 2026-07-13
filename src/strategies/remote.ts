import type { AuthLogger } from '../core/logger';
import type { ResolvedAuthConfig } from '../core/types';
import { resolveReturnPath } from '../core/returnPath';

export function buildRemoteLoginUrl(
  config: ResolvedAuthConfig,
  returnPath?: string,
  logger?: AuthLogger,
): string {
  const loginUrl = config.loginUrl ?? '/account/login';
  const blocked = config.appPath ? [config.appPath, '/account'] : ['/account'];
  const safeRedirect = resolveReturnPath(
    returnPath
      ?? (typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/'),
    '/',
    blocked,
  );

  const url = `${loginUrl}?redirect=${encodeURIComponent(safeRedirect)}`;
  logger?.info('redirect.login', 'Redirecting to remote login', { url, returnPath: safeRedirect });

  return url;
}

export function redirectToRemoteLogin(
  config: ResolvedAuthConfig,
  returnPath?: string,
  logger?: AuthLogger,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.href = buildRemoteLoginUrl(config, returnPath, logger);
}
