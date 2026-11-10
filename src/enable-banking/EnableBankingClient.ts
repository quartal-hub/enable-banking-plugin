import { Helpers } from "@quartal/plugin";
import { importPKCS8, SignJWT } from "jose";

/** Enable Banking API base URL. The same host serves sandbox and production; the app decides which. */
const API_BASE = "https://api.enablebanking.com";

/** Lifetime of the signed API token, in seconds (Enable Banking allows at most 24 hours) */
const TOKEN_TTL_SECONDS = 3600;

/** Cached signing key and token, so a key is imported and a token signed once per hour, not per call */
let signingKey: Promise<CryptoKey> | undefined;
let cachedToken: { value: string; expiresAt: number } | undefined;

/**
 * Sends a request to the Enable Banking API and returns the parsed JSON response. Every call is
 * authorized with a JWT signed (RS256) by the application's private key, with the application id
 * as `kid`.
 *
 * Configuration (environment variables):
 * - `ENABLE_BANKING_APP_ID`: the application id from the Enable Banking control panel.
 * - `ENABLE_BANKING_PRIVATE_KEY`: the application's private key (PEM contents).
 * @param method HTTP method
 * @param path API path, e.g. `/aspsps?country=FI`
 * @param body Optional JSON body
 */
export async function enableBankingRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Enable Banking ${method} ${path.split("?")[0]} failed (${res.status}): ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Returns a valid API token, signing a new one when the cached one is about to expire */
async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  signingKey ??= importPKCS8(loadPrivateKey(), "RS256");
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const value = await new SignJWT()
    .setProtectedHeader({ typ: "JWT", alg: "RS256", kid: Helpers.getEnvVar("ENABLE_BANKING_APP_ID", "string") })
    .setIssuer("enablebanking.com")
    .setAudience("api.enablebanking.com")
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(await signingKey);
  cachedToken = { value, expiresAt };
  return value;
}

/** The PKCS#8 PEM private key from `ENABLE_BANKING_PRIVATE_KEY`; line breaks may be written as `\n` */
function loadPrivateKey(): string {
  return Helpers.getEnvVar("ENABLE_BANKING_PRIVATE_KEY", "string").replace(/\\n/g, "\n");
}
