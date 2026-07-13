# `@pinooxhq/auth`

## Auth for Pinoox themes — zero configuration.

Bring Pinoox authentication to your SPA with automatic token and session management, authorized HTTP, and seamless login redirects — for **Vue**, **React**, and **Svelte**. Powered by `window.__PINOOX__.auth`.

### What you get

- **Token & session** — automatic JWT or session handling with `me()`, logout, and 401 cleanup  
- **Authorized HTTP** — `createHttp()` keeps every request authenticated and in sync with auth state  
- **Seamless redirects** — return users safely after login, or delegate auth to a remote application  

Configure `auth.client` in `app.php`, install the module, and you’re ready to go.

## Contents

1. [Quick setup](#1-quick-setup)
2. [Why `auth.client`?](#2-why-authclient)
3. [App configuration](#3-app-configuration)
4. [Theme integration](#4-theme-integration)
5. [Strategies](#5-strategies)
6. [HTTP sync](#6-http-sync)
7. [Redirects](#7-redirects)
8. [Vue, React & Svelte](#8-vue-react--svelte)
9. [API reference](#9-api-reference)
10. [Vite integration](#10-vite-integration)

---

## 1. Quick setup

Minimal path from app config to a working theme module.

### Step 1 — App (`app.php`)

Publish a client-safe auth slice to the page:

```php
'auth' => [
    'mode' => 'jwt',
    'key' => 'acme_auth',
    'client' => true, // → window.__PINOOX__.auth
],
```

```bash
php pinoox pinker:rebuild com_acme_app -n
```



### Step 2 — Theme package

```bash
cd apps/com_acme_app/theme/default
npm install @pinooxhq/auth axios
```



### Step 3 — One module

`src/utils/auth/index.js`:

```js
import axios from 'axios'
import { defineStore } from 'pinia'
import { createAuth, createHttp } from '@pinooxhq/auth'
import { createPiniaAuthStore } from '@pinooxhq/auth/vue'

export const auth = createAuth({ debug: import.meta.env.DEV })
export const http = createHttp({ auth, axios })
export const useAuthStore = createPiniaAuthStore(defineStore, 'auth')
```

Use Pinia in `main.js`: `app.use(createPinia())`.

### Step 4 — Call it

```js
import { http, useAuthStore } from '@/utils/auth'
import { useAuthRedirect } from '@pinooxhq/auth/vue'

const store = useAuthStore()
const { redirectBack } = useAuthRedirect()

const { data } = await http.post('auth/login', { username, password })
store.login(data.token, data.user)
redirectBack()
```

---



## 2. Why `auth.client`?

PHP already knows how auth works (`mode`, `key`, remote login URL, API paths).  
The SPA cannot invent those values safely.

`auth.client` tells Pinoox: **send a safe subset to the browser** as
`window.__PINOOX__.auth` (via `pinoox_bootstrap()` in Twig).  
`createAuth()` then needs no hardcoded secrets or paths.


| Stays on server            | May go to the client                                     |
| -------------------------- | -------------------------------------------------------- |
| `jwt_secret`, lifetimes, … | `mode`, `key`, `provider`, `source`                      |
|                            | optional: `strategy`, `loginUrl`, `baseUrl`, `endpoints` |


Theme layout (usually already present):

```twig
{{ pinoox_bootstrap(bootstrap|default({}))|raw }}
```

Flow:

```
app.php auth.client  →  pinker + pinoox_bootstrap()  →  __PINOOX__.auth
                                                          ↓
                                              createAuth() / createHttp()
                                                          ↓
                                              pages · API · guards
```

---



## 3. App configuration



### Local app (owns login)

```php
'auth' => [
    'mode' => 'jwt',      // jwt | cookie | session
    'key' => 'acme_auth', // SPA storage key
    'client' => true,
],
```



### Remote app (login elsewhere)

```php
'transport' => ['user' => 'com_pinoox_account'],
'auth' => [
    'client' => [
        'strategy' => 'remote',
        'loginUrl' => '/account/login',
        'baseUrl' => '/account/api/v1',
        'endpoints' => [
            'me' => 'auth/get',
            'logout' => 'auth/logout',
        ],
    ],
],
```



### `auth.client` values


| Value            | Effect                                              |
| ---------------- | --------------------------------------------------- |
| `true`           | `{ mode, key, provider, source }`                   |
| `false`          | omit auth from `__PINOOX__` (configure JS manually) |
| `['mode','key']` | whitelist of base fields                            |
| `{ … }`          | base fields **merged** with extras                  |


Aliases: `via`, `expose`, `bootstrap`.

### `baseUrl` + endpoints

Prefer a shared API prefix and short paths:

```php
'baseUrl' => '/account/api/v1',
'endpoints' => [
    'me' => 'auth/get',       // → /account/api/v1/auth/get
    'logout' => 'auth/logout',
],
```

Or keep full paths (no `baseUrl`) — same as before:

```php
'endpoints' => [
    'me' => '/account/api/v1/auth/get',
    'logout' => '/account/api/v1/auth/logout',
],
```

Resolution rules:

- `https://…` or path starting with `/` → used as-is  
- relative path (`auth/get`) + `baseUrl` → joined  
- relative path without `baseUrl` → left as-is

---



## 4. Theme integration



### File

```
apps/{package}/theme/{theme}/src/utils/auth/index.js
```



### Exports


| Export         | Role                                                  |
| -------------- | ----------------------------------------------------- |
| `auth`         | Low-level client (`login`, `me`, `logout`, redirects) |
| `http`         | Axios with Bearer; `401` clears the session           |
| `useAuthStore` | Pinia: `token`, `user`, `login`, `canUserAccess`, …   |




### Login page

```vue
<script setup>
import { http, useAuthStore } from '@/utils/auth'
import { useAuthRedirect } from '@pinooxhq/auth/vue'

const store = useAuthStore()
const { redirectQuery, redirectBack } = useAuthRedirect()

const onLogin = async () => {
  const { data } = await http.post('auth/login', { username, password })
  const body = data?.data ?? data
  store.login(body.token, body.user)
  redirectBack()
}
</script>
```



### Router guard

```js
import { auth, useAuthStore } from '@/utils/auth'

export async function authGuard(to, _from, next) {
  const store = useAuthStore()

  if (to.meta.requiresAuth && !store.token) {
    auth.redirectToLogin()
    return
  }

  if (store.token && to.name === 'page-login' && await store.canUserAccess()) {
    auth.redirectBack(to.query)
    return
  }

  next()
}
```

---



## 5. Strategies


| Value    | Meaning                         |
| -------- | ------------------------------- |
| `local`  | This app owns login (default)   |
| `remote` | Redirect to another app’s login |


Aliases: `provider` → `local`, `consumer` / `external` → `remote`.

```js
auth.redirectToLogin() // remote → loginUrl?redirect=…
auth.redirectBack()    // after login → safe ?redirect=
```

---



## 6. HTTP sync

`createHttp({ auth, axios })` wires:

- `Authorization` from `auth.getAuthHeader()`
- `401` → `auth.notifyUnauthorized()`
- `auth.setHttp(…)` so `login` / `me` / `logout` share the same transport

`baseURL` defaults to `__PINOOX__.url.API` (override with `baseURL` option).

---



## 7. Redirects

After local login, return to a safe `?redirect=` path.  
Uses `__PINOOX__.url.SITE` when the Vite origin differs from PHP.

```js
import { useAuthRedirect } from '@pinooxhq/auth/vue'

const { redirectQuery, redirectBack, returnUrl } = useAuthRedirect()
```

---



## 8. Vue, React & Svelte

### Vue

```js
import { useAuth, useAuthRedirect } from '@pinooxhq/auth/vue'
```

### React

```tsx
import { createAuth } from '@pinooxhq/auth'
import { AuthProvider, useAuth } from '@pinooxhq/auth/react'

createAuth()
```

Or `createReactAuth()` for a one-shot provider + hook.

### Svelte

```js
// src/lib/auth.js
import axios from 'axios'
import { createAuth, createHttp } from '@pinooxhq/auth'
import { createAuthStore, createAuthRedirect } from '@pinooxhq/auth/svelte'

export const auth = createAuth({ debug: import.meta.env.DEV })
export const http = createHttp({ auth, axios })
export const { user, token, isAuthenticated, login, logout, me, canAccess, setSession } =
  createAuthStore()
export const { redirectBack, redirectQuery } = createAuthRedirect()
```

```svelte
<script>
  import { user, isAuthenticated, logout, redirectBack } from '$lib/auth.js'
</script>

{#if $isAuthenticated}
  <p>Hi {$user?.username}</p>
  <button on:click={() => logout()}>Logout</button>
{:else}
  <button on:click={() => redirectBack()}>Continue</button>
{/if}
```

SvelteKit (reactive `?redirect=` from `$page`):

```js
import { derived } from 'svelte/store'
import { page } from '$app/stores'
import { createAuthRedirectFromStore } from '@pinooxhq/auth/svelte'

const query = derived(page, ($p) => Object.fromEntries($p.url.searchParams))
export const { redirectBack, redirectQuery } = createAuthRedirectFromStore(query)
```

### Modes


| mode                 | Storage                | Request                          |
| -------------------- | ---------------------- | -------------------------------- |
| `jwt`                | token under `auth.key` | `Authorization: Bearer …`        |
| `cookie` / `session` | optional               | cookies (`credentials: include`) |


---



## 9. API reference

```js
auth.login({ username, password })
auth.me()
auth.logout()
auth.getToken() / auth.setToken(t) / auth.clearToken()
auth.getAuthHeader()
auth.redirectToLogin() / auth.redirectBack()
auth.getReturnUrl() / auth.getRedirectQuery()
auth.notifyUnauthorized()

http.get / http.post / …
```

---

## 10. Vite integration

Vite integration for Pinoox app themes: Twig shell on PHP, frontend entry on Vite, HMR and production manifest wired for `vite_tags()` in PHP.

That stack is what loads `__PINOOX__` (including `auth.client`) before your SPA boots — so `@pinooxhq/auth` can stay zero-config.

| | |
|-|-|
| npm | [`@pinooxhq/vite-plugin`](https://www.npmjs.com/package/@pinooxhq/vite-plugin) |
| GitHub | [pinoox/vite-plugin](https://github.com/pinoox/vite-plugin) |
| Issues | [github.com/pinoox/vite-plugin/issues](https://github.com/pinoox/vite-plugin/issues) |

Theme layout (order matters):

```twig
{{ pinoox_bootstrap(bootstrap|default({}))|raw }}
{{ vite_tags() }}
```

---

## License

MIT