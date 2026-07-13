import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  createAuth,
  getAuth,
  type AuthInstance,
  type CreateAuthConfig,
  type AuthUser,
  type LoginCredentials,
  type LoginResult,
} from '../core/createAuth';

export interface UseAuthReturn {
  auth: AuthInstance;
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (credentials?: LoginCredentials) => Promise<LoginResult | void>;
  logout: () => Promise<void>;
  me: () => Promise<AuthUser | null>;
  canAccess: (refresh?: boolean) => Promise<boolean>;
}

interface AuthSnapshot {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthInstance | null>(null);

function resolveAuth(options?: CreateAuthConfig): AuthInstance {
  try {
    return getAuth();
  } catch {
    return createAuth(options ?? {});
  }
}

function readSnapshot(auth: AuthInstance): AuthSnapshot {
  const token = auth.getToken();
  const user = auth.user;

  return {
    user,
    token,
    isAuthenticated: auth.isAuthenticated || (!!token && !!user),
  };
}

function snapshotsEqual(a: AuthSnapshot, b: AuthSnapshot): boolean {
  return a.user === b.user
    && a.token === b.token
    && a.isAuthenticated === b.isAuthenticated;
}

function subscribeAuth(auth: AuthInstance, onStoreChange: () => void): () => void {
  const offLogin = auth.on('login', onStoreChange);
  const offLogout = auth.on('logout', onStoreChange);
  const offUnauthorized = auth.on('unauthorized', onStoreChange);

  return () => {
    offLogin();
    offLogout();
    offUnauthorized();
  };
}

export interface AuthProviderProps {
  children: ReactNode;
  /** Passed to createAuth when no global instance exists yet */
  options?: CreateAuthConfig;
  /** Existing auth instance (optional) */
  auth?: AuthInstance;
}

/**
 * Optional provider. Without it, `useAuth()` still works against the global createAuth() instance.
 */
export function AuthProvider({ children, options, auth: authProp }: AuthProviderProps) {
  const auth = useMemo(() => authProp ?? resolveAuth(options), [authProp, options]);

  return createElement(AuthContext.Provider, { value: auth }, children);
}

function useAuthInstance(): AuthInstance {
  const ctx = useContext(AuthContext);

  if (ctx) {
    return ctx;
  }

  return resolveAuth();
}

export function useAuth(): UseAuthReturn {
  const auth = useAuthInstance();
  const cache = useRef<AuthSnapshot>(readSnapshot(auth));

  const snapshot = useSyncExternalStore(
    (onStoreChange) => subscribeAuth(auth, onStoreChange),
    () => {
      const next = readSnapshot(auth);

      if (!snapshotsEqual(cache.current, next)) {
        cache.current = next;
      }

      return cache.current;
    },
    () => ({
      user: null,
      token: null,
      isAuthenticated: false,
    }),
  );

  const me = useCallback(async (): Promise<AuthUser | null> => {
    return auth.me();
  }, [auth]);

  const canAccess = useCallback(async (refresh = false): Promise<boolean> => {
    const token = auth.getToken();

    if (!refresh && auth.isAuthenticated) {
      return true;
    }

    if (!token && auth.config.mode === 'jwt') {
      auth.isAuthenticated = false;
      return false;
    }

    const profile = await auth.me();
    return !!profile || auth.isAuthenticated;
  }, [auth]);

  const login = useCallback(async (credentials?: LoginCredentials): Promise<LoginResult | void> => {
    return auth.login(credentials);
  }, [auth]);

  const logout = useCallback(async (): Promise<void> => {
    await auth.logout();
  }, [auth]);

  return {
    auth,
    user: snapshot.user,
    token: snapshot.token,
    isAuthenticated: snapshot.isAuthenticated,
    login,
    logout,
    me,
    canAccess,
  };
}

/**
 * Create auth once at app root (same as createAuth) and return a ready AuthProvider wrapper.
 */
export function createReactAuth(options: CreateAuthConfig = {}) {
  const auth = createAuth(options);

  function BoundAuthProvider({ children }: { children: ReactNode }) {
    return createElement(AuthProvider, { auth, children });
  }

  return {
    auth,
    AuthProvider: BoundAuthProvider,
    useAuth,
  };
}
