import type { PinooxBootstrap } from './types';

const DEFAULT_FALLBACK = '/';
const DEFAULT_BLOCKED = ['/account'];

export function isSafeReturnPath(
  value: unknown,
  blockedPrefixes: string[] = DEFAULT_BLOCKED,
): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return false;
  }

  if (trimmed.includes('://') || trimmed.includes('\\')) {
    return false;
  }

  for (const prefix of blockedPrefixes) {
    if (!prefix) {
      continue;
    }

    if (trimmed === prefix || trimmed.startsWith(`${prefix}/`)) {
      return false;
    }
  }

  return true;
}

export function resolveReturnPath(
  queryOrPath: unknown = undefined,
  fallback: string = DEFAULT_FALLBACK,
  blockedPrefixes: string[] = DEFAULT_BLOCKED,
): string {
  let candidate: unknown = queryOrPath;

  if (queryOrPath && typeof queryOrPath === 'object' && !Array.isArray(queryOrPath)) {
    candidate = (queryOrPath as { redirect?: unknown }).redirect;
  }

  if (candidate === undefined && typeof window !== 'undefined') {
    candidate = new URLSearchParams(window.location.search).get('redirect');
  }

  if (isSafeReturnPath(candidate, blockedPrefixes)) {
    return (candidate as string).trim();
  }

  return fallback;
}

export function resolveSiteOrigin(
  bootUrl?: PinooxBootstrap['url'],
  explicit?: string | null,
): string | null {
  const candidates = [explicit, bootUrl?.SITE];

  for (const value of candidates) {
    if (typeof value !== 'string' || !value) {
      continue;
    }

    try {
      return new URL(value).origin;
    } catch {
      const cleaned = value.replace(/\/$/, '');
      if (/^https?:\/\//i.test(cleaned)) {
        return cleaned;
      }
    }
  }

  return null;
}

export function toAbsoluteReturnUrl(path: string, siteOrigin?: string | null): string {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return path;
  }

  if (!siteOrigin || typeof window === 'undefined') {
    return path;
  }

  if (window.location.origin === siteOrigin) {
    return path;
  }

  return `${siteOrigin.replace(/\/$/, '')}${path}`;
}

export function redirectToReturn(
  queryOrPath?: unknown,
  options: {
    fallback?: string;
    siteOrigin?: string | null;
    blockedPrefixes?: string[];
  } = {},
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const path = resolveReturnPath(queryOrPath, options.fallback, options.blockedPrefixes);
  window.location.href = toAbsoluteReturnUrl(path, options.siteOrigin);
}
