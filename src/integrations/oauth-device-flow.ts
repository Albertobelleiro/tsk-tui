import { openBrowser } from "./oauth-helpers.ts";

async function postForm(url: string, payload: Record<string, string>): Promise<Record<string, unknown>> {
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
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return Object.fromEntries(new URLSearchParams(text).entries());
    }
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDeviceFlow(options: {
  deviceCodeUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
}): Promise<{ accessToken: string }> {
  const init = await postForm(options.deviceCodeUrl, {
    client_id: options.clientId,
    scope: options.scopes.join(" "),
  });

  const deviceCode = init.device_code;
  const userCode = init.user_code;
  const verifyUri = init.verification_uri;
  const intervalRaw = init.interval;

  if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verifyUri !== "string") {
    throw new Error("Invalid device flow response");
  }

  let intervalSec = typeof intervalRaw === "number" ? intervalRaw : 5;

  console.log(`Enter code ${userCode} at ${verifyUri}`);
  await openBrowser(verifyUri);

  while (true) {
    await sleep(intervalSec * 1000);
    const tokenResp = await postForm(options.tokenUrl, {
      client_id: options.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    if (typeof tokenResp.access_token === "string" && tokenResp.access_token.length > 0) {
      return { accessToken: tokenResp.access_token };
    }

    const error = tokenResp.error;
    if (error === "authorization_pending") {
      continue;
    }
    if (error === "slow_down") {
      intervalSec += 5;
      continue;
    }
    if (error === "expired_token") {
      throw new Error("Device code expired");
    }
    if (error === "access_denied") {
      throw new Error("Access denied by user");
    }

    throw new Error(String(tokenResp.error_description ?? error ?? "Device flow failed"));
  }
}
