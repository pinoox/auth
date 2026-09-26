import type { AuthLogger } from "./logger";
import { jwtMatchesAuthKey } from "./jwt";

export interface TokenStorage {
  get: () => string | null;
  set: (token: string | null) => void;
  clear: () => void;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") {
    return;
  }

  const maxAge = 60 * 60 * 24 * 90;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

function deleteCookie(name: string): void {
  if (typeof document === "undefined") {
    return;
  }

  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax${secure}`;
}

function acceptToken(value: string | null, key: string, logger?: AuthLogger): string | null {
  if (!value) {
    return null;
  }

  if (!key) {
    return value;
  }

  if (jwtMatchesAuthKey(value, key)) {
    return value;
  }

  logger?.warn("mismatch.key", "Stored JWT claim does not match auth.key — discarding", { key });
  return null;
}

export function createStorage(key: string, logger?: AuthLogger): TokenStorage {
  // Cookies are always kept in sync with localStorage so browser media/download requests authenticate seamlessly.

  return {
    get: () => {
      if (!key) {
        return null;
      }

      try {
        if (typeof localStorage !== "undefined") {
          const fromStorage = acceptToken(localStorage.getItem(key)?.trim() || null, key, logger);

          if (fromStorage) {
            writeCookie(key, fromStorage);
            return fromStorage;
          }

          // Stale / wrong-app token left in LS — drop it so cookie can recover.
          if (localStorage.getItem(key)) {
            localStorage.removeItem(key);
          }
        }
      } catch (error) {
        logger?.warn("token.storage", "Failed to read localStorage", { error: String(error) });
      }

      const fromCookie = acceptToken(readCookie(key), key, logger);

      if (fromCookie) {
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(key, fromCookie);
          }
        } catch {
          // ignore
        }

        return fromCookie;
      }

      return null;
    },

    set: (token) => {
      if (!key) {
        logger?.warn("mismatch.key", "Cannot store token without auth.key");
        return;
      }

      if (typeof localStorage === "undefined") {
        return;
      }

      try {
        if (token) {
          const value = acceptToken(token.trim(), key, logger);
          if (!value) {
            localStorage.removeItem(key);
            deleteCookie(key);
            return;
          }

          localStorage.setItem(key, value);
          logger?.debug("token.stored", "Token stored", { key });
          writeCookie(key, value);
        } else {
          localStorage.removeItem(key);
          logger?.debug("token.cleared", "Token cleared", { key });
          deleteCookie(key);
        }
      } catch (error) {
        logger?.warn("token.storage", "Failed to write storage", { error: String(error) });
      }
    },

    clear: () => {
      if (!key || typeof localStorage === "undefined") {
        return;
      }

      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }

      deleteCookie(key);
      logger?.debug("token.cleared", "Token cleared", { key });
    },
  };
}
