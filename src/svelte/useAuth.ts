import { derived, writable, type Readable, type Writable } from 'svelte/store';
import {
  createAuth,
  getAuth,
  type AuthInstance,
  type CreateAuthConfig,
  type AuthUser,
  type LoginCredentials,
  type LoginResult,
} from '../core/createAuth';
import { hasUsableProfile } from '../core/userProfile';

export interface AuthStore {
  auth: AuthInstance;
  user: Writable<AuthUser | null>;
  token: Writable<string | null>;
  isAuthenticated: Readable<boolean>;
  login: (credentials?: LoginCredentials) => Promise<LoginResult | void>;
  logout: () => Promise<void>;
  me: () => Promise<AuthUser | null>;
  canAccess: (refresh?: boolean) => Promise<boolean>;
  /** Set token (+ optional user) after a custom login API call. */
  setSession: (loginKey: string, userData?: AuthUser | null) => void;
}

export interface AuthRedirectStore {
  returnPath: Readable<string>;
  returnUrl: Readable<string>;
  redirectQuery: Readable<{ redirect: string }>;
  resolveRedirect: () => string;
  redirectBack: () => void;
}

type QueryInput = Record<string, unknown> | URLSearchParams | string;

let bound: AuthStore | null = null;

function resolveAuthInstance(options?: CreateAuthConfig): AuthInstance {
  try {
    return getAuth();
  } catch {
    return createAuth(options ?? {});
  }
}

function readQueryFromWindow(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }

  return Object.fromEntries(new URLSearchParams(window.location.search).entries());
}

function normalizeQuery(input: QueryInput): Record<string, unknown> {
  if (typeof input === 'string') {
    const raw = input.startsWith('?') ? input.slice(1) : input;
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }

  if (input instanceof URLSearchParams) {
    return Object.fromEntries(input.entries());
  }

  return input;
}

/**
 * Reactive auth bound to Svelte stores. Call once (e.g. `lib/auth.js`) and import everywhere.
 */
export function createAuthStore(options: CreateAuthConfig = {}): AuthStore {
  if (bound) {
    return bound;
  }

  const auth = resolveAuthInstance(options);
  const user = writable<AuthUser | null>(auth.user);
  const token = writable<string | null>(auth.getToken());

  const syncFromAuth = (): void => {
    user.set(auth.user);
    token.set(auth.getToken());
  };

  auth.on('login', syncFromAuth);
  auth.on('logout', syncFromAuth);
  auth.on('unauthorized', syncFromAuth);

  const isAuthenticated = derived([user, token], ([$user, $token]) => {
    return auth.isAuthenticated || !!$token;
  });

  const me = async (): Promise<AuthUser | null> => {
    const profile = await auth.me();
    syncFromAuth();
    return profile;
  };

  const canAccess = async (refresh = false): Promise<boolean> => {
    token.set(auth.getToken());

    if (!refresh && auth.isAuthenticated && hasUsableProfile(auth.user)) {
      return true;
    }

    // Hit me() for cookie sessions and to hydrate profile from JWT storage.
    const profile = await me();
    return hasUsableProfile(profile) || hasUsableProfile(auth.user) || auth.isAuthenticated;
  };

  const login = async (credentials?: LoginCredentials): Promise<LoginResult | void> => {
    const result = await auth.login(credentials);
    syncFromAuth();
    return result;
  };

  const logout = async (): Promise<void> => {
    await auth.logout();
    syncFromAuth();
  };

  const setSession = (loginKey: string, userData: AuthUser | null = null): void => {
    auth.setToken(loginKey);
    auth.isAuthenticated = true;
    token.set(loginKey);

    if (hasUsableProfile(userData)) {
      auth.user = userData;
      user.set(userData);
    }
  };

  bound = {
    auth,
    user,
    token,
    isAuthenticated,
    login,
    logout,
    me,
    canAccess,
    setSession,
  };

  return bound;
}

/** Same as createAuthStore — handy name in `.svelte` files. */
export function useAuth(options?: CreateAuthConfig): AuthStore {
  return createAuthStore(options ?? {});
}

/**
 * Post-login return helpers.
 * Default: read `?redirect=` from `window.location`.
 * Pass a getter for SvelteKit (`() => get(page).url.searchParams`).
 */
export function createAuthRedirect(
  getQuery: () => QueryInput = readQueryFromWindow,
  fallback = '/',
): AuthRedirectStore {
  const auth = resolveAuthInstance();

  const readPath = () => auth.getReturnPath(normalizeQuery(getQuery()), fallback);
  const readUrl = () => auth.getReturnUrl(normalizeQuery(getQuery()), fallback);
  const readRedirectQuery = () => auth.getRedirectQuery(normalizeQuery(getQuery()), fallback);

  const returnPath: Readable<string> = {
    subscribe(run) {
      run(readPath());
      return () => undefined;
    },
  };

  const returnUrl: Readable<string> = {
    subscribe(run) {
      run(readUrl());
      return () => undefined;
    },
  };

  const redirectQuery: Readable<{ redirect: string }> = {
    subscribe(run) {
      run(readRedirectQuery());
      return () => undefined;
    },
  };

  return {
    returnPath,
    returnUrl,
    redirectQuery,
    resolveRedirect: readUrl,
    redirectBack: () => auth.redirectBack(normalizeQuery(getQuery()), fallback),
  };
}

/**
 * Reactive redirect helpers from a Svelte readable query
 * (e.g. derived from SvelteKit `$page`).
 */
export function createAuthRedirectFromStore(
  queryStore: Readable<QueryInput>,
  fallback = '/',
): AuthRedirectStore {
  const auth = resolveAuthInstance();
  let latest: QueryInput = {};

  const unsub = queryStore.subscribe((value) => {
    latest = value;
  });
  unsub();

  const returnPath = derived(queryStore, ($q) => {
    latest = $q;
    return auth.getReturnPath(normalizeQuery($q), fallback);
  });

  const returnUrl = derived(queryStore, ($q) => {
    latest = $q;
    return auth.getReturnUrl(normalizeQuery($q), fallback);
  });

  const redirectQuery = derived(queryStore, ($q) => {
    latest = $q;
    return auth.getRedirectQuery(normalizeQuery($q), fallback);
  });

  return {
    returnPath,
    returnUrl,
    redirectQuery,
    resolveRedirect: () => auth.getReturnUrl(normalizeQuery(latest), fallback),
    redirectBack: () => auth.redirectBack(normalizeQuery(latest), fallback),
  };
}

/** Create auth once and return the store bundle (like createReactAuth). */
export function createSvelteAuth(options: CreateAuthConfig = {}) {
  const store = createAuthStore(options);

  return {
    ...store,
    useAuth: () => store,
    createAuthRedirect,
    createAuthRedirectFromStore,
  };
}
