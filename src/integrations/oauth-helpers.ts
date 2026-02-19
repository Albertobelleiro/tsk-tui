import { startOAuthCallback } from "./oauth-server.ts";

function toBase64Url(buffer: Uint8Array): string {
  const base64 = Buffer.from(buffer).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateCodeVerifier(): string {
  const random = crypto.getRandomValues(new Uint8Array(64));
  return toBase64Url(random).slice(0, 128);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return toBase64Url(new Uint8Array(hash));
}

export function generateState(): string {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(random).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function openBrowser(url: string): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      await Bun.$`open ${url}`;
      return true;
    }
    if (process.platform === "linux") {
      await Bun.$`xdg-open ${url}`;
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

async function postForm(
  url: string,
  payload: Record<string, string>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(payload).toString(),
      signal: controller.signal,
    });
    const text = await response.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = Object.fromEntries(new URLSearchParams(text).entries());
    }
    if (!response.ok) {
      throw new Error(String(data.error_description ?? data.error ?? `HTTP ${response.status}`));
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function exchangeCodeForToken(options: {
  tokenUrl: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier?: string;
  extraParams?: Record<string, string>;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; [key: string]: unknown }> {
  const payload: Record<string, string> = {
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
    ...(options.codeVerifier ? { code_verifier: options.codeVerifier } : {}),
    ...(options.extraParams ?? {}),
  };

  const data = await postForm(options.tokenUrl, payload);
  const accessToken = data.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Token response missing access_token");
  }

  return {
    ...data,
    access_token: accessToken,
    refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
  };
}

export async function refreshAccessToken(options: {
  tokenUrl: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const data = await postForm(options.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
    client_id: options.clientId,
    ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
  });

  const accessToken = data.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Refresh response missing access_token");
  }

  return {
    access_token: accessToken,
    refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
  };
}

export async function runOAuthFlow(options: {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  usePkce?: boolean;
  extraAuthorizeParams?: Record<string, string>;
}): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; raw: Record<string, unknown> }> {
  const state = generateState();
  const usePkce = options.usePkce ?? true;
  const codeVerifier = usePkce ? generateCodeVerifier() : undefined;
  const codeChallenge = codeVerifier ? await generateCodeChallenge(codeVerifier) : undefined;

  const callback = await startOAuthCallback({ expectedState: state });
  try {
    const authUrl = new URL(options.authorizeUrl);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", options.clientId);
    authUrl.searchParams.set("redirect_uri", callback.url);
    authUrl.searchParams.set("state", state);
    if (options.scopes.length > 0) authUrl.searchParams.set("scope", options.scopes.join(" "));
    if (codeChallenge) {
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
    }
    for (const [k, v] of Object.entries(options.extraAuthorizeParams ?? {})) {
      authUrl.searchParams.set(k, v);
    }

    const opened = await openBrowser(authUrl.toString());
    if (!opened) {
      console.log(`Open this URL to authenticate:\n${authUrl.toString()}`);
    }

    const callbackResult = await callback.result;
    const token = await exchangeCodeForToken({
      tokenUrl: options.tokenUrl,
      code: callbackResult.code,
      redirectUri: callback.url,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      codeVerifier,
    });

    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      raw: token,
    };
  } finally {
    callback.shutdown();
  }
}
