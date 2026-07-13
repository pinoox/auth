export type AuthMode = 'jwt' | 'cookie' | 'session';

export type AuthStrategy = 'local' | 'remote';

export type AuthEvent =
  | 'unauthorized'
  | 'mismatch'
  | 'error'
  | 'login'
  | 'logout'
  | 'config';

export interface BootAuthConfig {
  mode?: string;
  key?: string;
  provider?: string | null;
  source?: string | null;
  strategy?: AuthStrategy | string;
  loginUrl?: string;
  /** Prefix for relative endpoint paths (e.g. `/account/api/v1`). */
  baseUrl?: string | null;
  endpoints?: AuthEndpoints;
}

export interface PinooxBootstrap {
  url?: {
    API?: string;
    APP?: string;
    BASE?: string;
    SITE?: string;
    [key: string]: string | undefined;
  };
  locale?: string;
  auth?: BootAuthConfig;
  [key: string]: unknown;
}

export interface AuthEndpoints {
  login?: string;
  logout?: string;
  me?: string;
}

export interface ResolvedAuthConfig {
  mode: AuthMode;
  key: string;
  provider: string | null;
  source: string | null;
  strategy: AuthStrategy;
  loginUrl: string | null;
  /** Optional prefix used to resolve relative endpoint paths. */
  baseUrl: string | null;
  endpoints: Required<AuthEndpoints>;
  apiBase: string;
  /** Site origin from __PINOOX__.url.SITE (for Vite HMR absolute redirects). */
  siteOrigin: string | null;
  /** App path prefix e.g. /account — blocked as post-login return target. */
  appPath: string | null;
  debug: boolean;
}

export interface LoginCredentials {
  username?: string;
  email?: string;
  mobile?: string;
  password: string;
  remember?: boolean;
  [key: string]: unknown;
}

export interface AuthUser {
  [key: string]: unknown;
}

export interface LoginResult {
  token: string | null;
  user: AuthUser | null;
  raw: unknown;
}

export interface AuthRequestAuth {
  header: string | null;
  credentials: RequestCredentials;
  mode: AuthMode;
  key: string;
}

export interface AuthLogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export type AuthEventHandler = (payload?: unknown) => void;

export type AuthLogSink = (event: AuthLogEvent) => void;
