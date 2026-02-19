interface OAuthCallbackResult {
  code: string;
  state: string;
}

interface OAuthServerOptions {
  expectedState: string;
  timeoutMs?: number;
  successHtml?: string;
  errorHtml?: string;
}

interface OAuthServer {
  port: number;
  url: string;
  result: Promise<OAuthCallbackResult>;
  shutdown: () => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function html(content: string): string {
  return `<!doctype html><html><body style=\"font-family:sans-serif;padding:2rem\">${content}</body></html>`;
}

export async function startOAuthCallback(options: OAuthServerOptions): Promise<OAuthServer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const successHtml = options.successHtml ?? html("Authentication successful! You can close this tab.");
  const errorHtml = options.errorHtml ?? html("Authentication failed. You can close this tab.");

  let resolveResult: ((value: OAuthCallbackResult) => void) | null = null;
  let rejectResult: ((reason?: unknown) => void) | null = null;

  const result = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  let completed = false;

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") {
        return new Response("Not found", { status: 404 });
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        if (!completed) {
          completed = true;
          rejectResult?.(new Error("Missing code or state in OAuth callback"));
        }
        return new Response(errorHtml, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }

      if (state !== options.expectedState) {
        if (!completed) {
          completed = true;
          rejectResult?.(new Error("OAuth state mismatch"));
        }
        return new Response(errorHtml, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }

      if (!completed) {
        completed = true;
        resolveResult?.({ code, state });
      }

      return new Response(successHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });

  const shutdown = () => {
    if (!completed) {
      completed = true;
      rejectResult?.(new Error("OAuth callback server closed"));
    }
    try {
      server.stop(true);
    } catch {
      // ignore
    }
  };

  const timeout = setTimeout(() => {
    if (!completed) {
      completed = true;
      rejectResult?.(new Error("OAuth callback timed out"));
    }
    try {
      server.stop(true);
    } catch {
      // ignore
    }
  }, timeoutMs);

  result.finally(() => {
    clearTimeout(timeout);
    try {
      server.stop(true);
    } catch {
      // ignore
    }
  }).catch(() => undefined);

  const port = server.port;
  if (port === undefined) {
    shutdown();
    throw new Error("OAuth callback server failed to acquire a port");
  }
  return {
    port,
    url: `http://localhost:${port}/callback`,
    result,
    shutdown,
  };
}

export type { OAuthCallbackResult, OAuthServer, OAuthServerOptions };
