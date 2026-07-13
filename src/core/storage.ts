import type { AuthLogger } from './logger';

export interface TokenStorage {
  get: () => string | null;
  set: (token: string | null) => void;
  clear: () => void;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  const maxAge = 60 * 60 * 24 * 90;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

function isDev(): boolean {
  try {
    return typeof import.meta !== 'undefined' && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  } catch {
    return false;
  }
}

export function createStorage(key: string, logger?: AuthLogger): TokenStorage {
  const syncDevCookie = isDev();

  return {
    get: () => {
      if (!key) {
        return null;
      }

      try {
        if (typeof localStorage !== 'undefined') {
          const fromStorage = localStorage.getItem(key)?.trim() || null;

          if (fromStorage) {
            if (syncDevCookie) {
              writeCookie(key, fromStorage);
            }

            return fromStorage;
          }
        }
      } catch (error) {
        logger?.warn('token.storage', 'Failed to read localStorage', { error: String(error) });
      }

      if (!syncDevCookie) {
        return null;
      }

      const fromCookie = readCookie(key);

      if (fromCookie) {
        try {
          localStorage.setItem(key, fromCookie);
        } catch {
          // ignore
        }

        return fromCookie;
      }

      return null;
    },

    set: (token) => {
      if (!key) {
        logger?.warn('mismatch.key', 'Cannot store token without auth.key');
        return;
      }

      if (typeof localStorage === 'undefined') {
        return;
      }

      try {
        if (token) {
          const value = token.trim();
          localStorage.setItem(key, value);
          logger?.debug('token.stored', 'Token stored', { key });

          if (syncDevCookie) {
            writeCookie(key, value);
          }
        } else {
          localStorage.removeItem(key);
          logger?.debug('token.cleared', 'Token cleared', { key });

          if (syncDevCookie) {
            deleteCookie(key);
          }
        }
      } catch (error) {
        logger?.warn('token.storage', 'Failed to write storage', { error: String(error) });
      }
    },

    clear: () => {
      if (!key || typeof localStorage === 'undefined') {
        return;
      }

      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }

      if (syncDevCookie) {
        deleteCookie(key);
      }

      logger?.debug('token.cleared', 'Token cleared', { key });
    },
  };
}
