import type { AuthInstance } from '../core/createAuth';
import { getAuth } from '../core/createAuth';
import type { HttpClient, HttpRequestInput, HttpResponse } from './types';

/** Minimal axios surface — pass your project's axios import. */
export interface AxiosLike {
  create: (config?: Record<string, unknown>) => AxiosInstanceLike;
}

export interface AxiosInstanceLike {
  defaults: { baseURL?: string; headers: Record<string, unknown> };
  interceptors: {
    request: {
      use: (
        onFulfilled: (config: Record<string, unknown>) => unknown,
        onRejected?: (error: unknown) => unknown,
      ) => number;
    };
    response: {
      use: (
        onFulfilled: (response: AxiosResponseLike) => unknown,
        onRejected?: (error: unknown) => unknown,
      ) => number;
    };
  };
  request: <T = unknown>(config: Record<string, unknown>) => Promise<AxiosResponseLike<T>>;
  get: <T = unknown>(url: string, config?: Record<string, unknown>) => Promise<AxiosResponseLike<T>>;
  post: <T = unknown>(url: string, data?: unknown, config?: Record<string, unknown>) => Promise<AxiosResponseLike<T>>;
  put: <T = unknown>(url: string, data?: unknown, config?: Record<string, unknown>) => Promise<AxiosResponseLike<T>>;
  patch: <T = unknown>(url: string, data?: unknown, config?: Record<string, unknown>) => Promise<AxiosResponseLike<T>>;
  delete: <T = unknown>(url: string, config?: Record<string, unknown>) => Promise<AxiosResponseLike<T>>;
}

export interface AxiosResponseLike<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface CreateHttpOptions {
  /** Defaults to getAuth() */
  auth?: AuthInstance;
  /** Your axios import (peer — not bundled). */
  axios: AxiosLike;
  /** Defaults to auth.config.apiBase / __PINOOX__.url.API */
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  /** Wire auth.login / me / logout onto this client (default true). */
  syncAuth?: boolean;
}

function resolveBaseURL(auth: AuthInstance, explicit?: string): string {
  const raw = (explicit || auth.config.apiBase || '/').trim();
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function createAxiosAuthAdapter(client: AxiosInstanceLike, siteOrigin?: string | null): HttpClient {
  return {
    async request<T = unknown>(input: HttpRequestInput): Promise<HttpResponse<T>> {
      try {
        let requestUrl = input.url;
        if (typeof requestUrl === 'string' && requestUrl.startsWith('/') && !/^https?:\/\//i.test(requestUrl)) {
          if (siteOrigin) {
            requestUrl = siteOrigin.replace(/\/$/, '') + requestUrl;
          } else if (typeof window !== 'undefined' && window.location?.origin) {
            requestUrl = window.location.origin + requestUrl;
          }
        }
        const isAbsolute = typeof requestUrl === 'string' && /^https?:\/\//i.test(requestUrl);
        const response = await client.request<T>({
          url: requestUrl,
          baseURL: isAbsolute ? '' : undefined,
          method: input.method ?? 'GET',
          headers: input.headers,
          data: input.body,
          withCredentials: (input.credentials ?? 'include') === 'include',
          validateStatus: () => true,
        });

        return {
          status: response.status,
          data: response.data,
          headers: response.headers as unknown as Headers,
          ok: response.status >= 200 && response.status < 300,
        };
      } catch (error) {
        const err = error as { response?: AxiosResponseLike<T>; message?: string };
        if (err.response) {
          return {
            status: err.response.status,
            data: err.response.data,
            headers: err.response.headers as unknown as Headers,
            ok: false,
          };
        }

        throw error;
      }
    },
  };
}

/**
 * Create an axios client synced with `@pinooxhq/auth`:
 * - Authorization header from auth
 * - 401 → auth.notifyUnauthorized()
 * - auth.setHttp() so login/me/logout share the same transport
 */
export function createHttp(options: CreateHttpOptions): AxiosInstanceLike {
  const auth = options.auth ?? getAuth();
  const baseURL = resolveBaseURL(auth, options.baseURL);

  const client = options.axios.create({
    baseURL,
    timeout: options.timeout ?? 30000,
    withCredentials: true,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...options.headers,
    },
  });

  client.interceptors.request.use((config) => {
    const headers = (config.headers ?? {}) as Record<string, unknown>;
    const authHeader = auth.getAuthHeader();

    if (authHeader) {
      headers.Authorization = authHeader;
    }

    if (typeof document !== 'undefined') {
      const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
      if (csrf) {
        headers['X-CSRF-TOKEN'] = csrf;
      }
    }

    config.headers = headers;
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;

      if (status === 401) {
        auth.notifyUnauthorized(error);
      }

      return Promise.reject(error);
    },
  );

  if (options.syncAuth !== false) {
    auth.setHttp(createAxiosAuthAdapter(client, auth.config.siteOrigin));
  }

  return client;
}
