import type { AuthUser } from './types';

/**
 * True when `user` looks like a real profile from login/me (Pinoox clientUser),
 * not a token-only stub such as `{ manager_proxied: true }`.
 */
export function hasUsableProfile(user: AuthUser | null | undefined): boolean {
  if (!user || typeof user !== 'object') {
    return false;
  }

  const record = user as Record<string, unknown>;

  if (record.manager_proxied === true) {
    return false;
  }

  return !!(
    record.user_id
    || record.id
    || record.username
    || record.email
    || record.group_key
  );
}
