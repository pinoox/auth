import { computed, ref, type Ref, type ComputedRef } from 'vue';
import { useRoute } from 'vue-router';
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
  user: Ref<AuthUser | null>;
  token: Ref<string | null>;
  isAuthenticated: ComputedRef<boolean>;
  login: (credentials?: LoginCredentials) => Promise<LoginResult | void>;
  logout: () => Promise<void>;
  me: () => Promise<AuthUser | null>;
  canAccess: (refresh?: boolean) => Promise<boolean>;
}

export interface UseAuthRedirectReturn {
  returnPath: ComputedRef<string>;
  returnUrl: ComputedRef<string>;
  redirectQuery: ComputedRef<{ redirect: string }>;
  resolveRedirect: () => string;
  redirectBack: () => void;
}

let vueBound: UseAuthReturn | null = null;

function resolveAuthInstance(): AuthInstance {
  try {
    return getAuth();
  } catch {
    return createAuth();
  }
}

export function createAuthPlugin(options: CreateAuthConfig = {}) {
  const auth = createAuth(options);

  return {
    install() {
      // noop install — instance is global via createAuth/getAuth
      void auth;
    },
    auth,
  };
}

export function useAuth(): UseAuthReturn {
  if (vueBound) {
    return vueBound;
  }

  const auth = resolveAuthInstance();

  const user = ref<AuthUser | null>(auth.user);
  const token = ref<string | null>(auth.getToken());

  const syncFromAuth = (): void => {
    user.value = auth.user;
    token.value = auth.getToken();
  };

  auth.on('login', syncFromAuth);
  auth.on('logout', syncFromAuth);

  const isAuthenticated = computed(() => {
    // JWT in storage is enough — profile (`user`) may load later via me().
    return auth.isAuthenticated || !!token.value;
  });

  const me = async (): Promise<AuthUser | null> => {
    const profile = await auth.me();
    syncFromAuth();
    return profile;
  };

  const canAccess = async (refresh = false): Promise<boolean> => {
    token.value = auth.getToken();

    if (!refresh && auth.isAuthenticated) {
      return true;
    }

    // Always hit me() — HttpOnly cookies authenticate without local JWT storage.
    const profile = await me();
    return !!profile || auth.isAuthenticated;
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

  vueBound = {
    auth,
    user,
    token,
    isAuthenticated,
    login,
    logout,
    me,
    canAccess,
  };

  return vueBound;
}

/**
 * Post-login return URL helpers bound to the current route `?redirect=`.
 */
export function useAuthRedirect(fallback = '/'): UseAuthRedirectReturn {
  const route = useRoute();
  const auth = resolveAuthInstance();

  const returnPath = computed(() => auth.getReturnPath(route.query, fallback));
  const returnUrl = computed(() => auth.getReturnUrl(route.query, fallback));
  const redirectQuery = computed(() => auth.getRedirectQuery(route.query, fallback));

  return {
    returnPath,
    returnUrl,
    redirectQuery,
    resolveRedirect: () => returnUrl.value,
    redirectBack: () => auth.redirectBack(route.query, fallback),
  };
}

export function createPiniaAuthStore(defineStore: typeof import('pinia').defineStore, id = 'pinoox-auth') {
  return defineStore(id, () => {
    const { auth, user, token, isAuthenticated, login, logout, me, canAccess } = useAuth();

    return {
      auth: isAuthenticated,
      user,
      token,
      isAuth: isAuthenticated,
      getUser: user,
      login: (loginKey: string, userData: AuthUser | null = null) => {
        auth.setToken(loginKey);
        token.value = loginKey;
        auth.isAuthenticated = true;

        if (userData) {
          auth.user = userData;
          user.value = userData;
        }
      },
      logout,
      canUserAccess: canAccess,
      syncTokenFromStorage: () => {
        const latest = auth.getToken();
        if (latest) {
          // Hydrate in-memory token so getAuthHeader() works immediately.
          auth.setToken(latest);
        }
        token.value = latest;
        return !!latest;
      },
      me,
      loginWithCredentials: login,
    };
  });
}
