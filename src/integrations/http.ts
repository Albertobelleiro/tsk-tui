const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_ON = new Set([429, 500, 502, 503]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiFetch<T>(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
    maxRetries?: number;
    retryOnStatus?: number[];
  },
): Promise<{ data: T; status: number } | { error: string; status: number }> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryOnStatus = new Set(options?.retryOnStatus ?? [...DEFAULT_RETRY_ON]);

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = options?.body === undefined
        ? undefined
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body);

      const response = await fetch(url, {
        method: options?.method ?? "GET",
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(options?.headers ?? {}),
        },
        body,
        signal: controller.signal,
      });

      const status = response.status;

      if (status === 401) {
        return { error: "Unauthorized (401)", status };
      }

      const text = await response.text();
      if (!response.ok) {
        if (retryOnStatus.has(status) && attempt < maxRetries) {
          const backoff = Math.pow(2, attempt - 1) * 1000;
          await sleep(backoff);
          continue;
        }
        return { error: text || `HTTP ${status}`, status };
      }

      let data: T;
      if (!text) {
        data = {} as T;
      } else {
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = text as T;
        }
      }
      return { data, status };
    } catch (error) {
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt - 1) * 1000;
        await sleep(backoff);
        continue;
      }
      return { error: error instanceof Error ? error.message : String(error), status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  return { error: "Request failed", status: 0 };
}

export async function graphqlFetch<T>(
  url: string,
  options: {
    query: string;
    variables?: Record<string, unknown>;
    token: string;
    timeoutMs?: number;
  },
): Promise<{ data: T } | { error: string }> {
  const response = await apiFetch<{ data?: T; errors?: Array<{ message?: string }> }>(url, {
    method: "POST",
    headers: {
      Authorization: options.token,
      "Content-Type": "application/json",
    },
    body: {
      query: options.query,
      variables: options.variables ?? {},
    },
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  if ("error" in response) {
    return { error: response.error };
  }

  if (response.data.errors && response.data.errors.length > 0) {
    return { error: response.data.errors[0]?.message ?? "GraphQL error" };
  }

  if (response.data.data === undefined) {
    return { error: "Missing GraphQL data" };
  }

  return { data: response.data.data };
}
