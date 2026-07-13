export interface HttpRequestInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  credentials?: RequestCredentials;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
  ok: boolean;
}

export interface HttpClient {
  request: <T = unknown>(input: HttpRequestInput) => Promise<HttpResponse<T>>;
}

export function createFetchProvider(): HttpClient {
  return {
    async request<T = unknown>(input: HttpRequestInput): Promise<HttpResponse<T>> {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...input.headers,
      };

      let body: BodyInit | undefined;

      if (input.body !== undefined && input.body !== null) {
        if (typeof input.body === 'string' || input.body instanceof FormData || input.body instanceof Blob) {
          body = input.body as BodyInit;
        } else {
          headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
          body = JSON.stringify(input.body);
        }
      }

      const response = await fetch(input.url, {
        method: input.method ?? 'GET',
        headers,
        body,
        credentials: input.credentials ?? 'include',
      });

      const contentType = response.headers.get('content-type') ?? '';
      let data: T;

      if (contentType.includes('application/json')) {
        data = (await response.json()) as T;
      } else {
        data = (await response.text()) as T;
      }

      return {
        status: response.status,
        data,
        headers: response.headers,
        ok: response.ok,
      };
    },
  };
}
