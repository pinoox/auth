/** Strip optional `Bearer ` prefix. */
export function normalizeBearerToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

/**
 * Decode JWT payload without verifying the signature (client-side guard only).
 * Returns null when the token is malformed.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const raw = normalizeBearerToken(token);
    const parts = raw.split('.');
    if (parts.length < 2) {
      return null;
    }

    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');

    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * True when the JWT payload contains the app auth claim (`auth.key`).
 * Prevents sending another app's token (e.g. manager_pinoox) as Bearer.
 */
export function jwtMatchesAuthKey(token: string | null | undefined, key: string | null | undefined): boolean {
  if (!token || !key) {
    return false;
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(payload, key)
    && payload[key] != null
    && String(payload[key]) !== '';
}
