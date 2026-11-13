import { Helpers } from "@quartal/plugin";

// Encrypted, self-contained tokens: the data travels inside the token (AES-256-GCM), so nothing has
// to be stored for it. Only this server can read or forge one. The key is derived from
// `ENABLE_BANKING_PRIVATE_KEY` (HKDF-SHA-256), so there is no extra secret to configure; changing
// the private key invalidates every token.

/** HKDF `info`: a new version here invalidates every earlier token */
const KEY_INFO = "enable-banking-plugin/sealed-token/v1";

/** Bytes of the AES-GCM nonce in front of the ciphertext */
const IV_BYTES = 12;

/** What is encrypted: the payload and its expiry */
interface Envelope<T> {
  value: T;
  /** Epoch milliseconds */
  expiresAt: number;
}

let cachedKey: { source: string; key: Promise<CryptoKey> } | undefined;

/** The AES-GCM key derived from the Enable Banking private key, cached while the key stays the same */
function getKey(): Promise<CryptoKey> {
  const source = Helpers.getEnvVar("ENABLE_BANKING_PRIVATE_KEY", "string").replace(/\\n/g, "\n");
  if (cachedKey?.source !== source) {
    const key = crypto.subtle
      .importKey("raw", new TextEncoder().encode(source), "HKDF", false, ["deriveKey"])
      .then((material) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode(KEY_INFO) },
          material,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    cachedKey = { source, key };
  }
  return cachedKey.key;
}

/**
 * Encrypts a value into a URL-safe token
 * @param purpose What the token is for, e.g. `print`. A token opens only for the same purpose.
 * @param value Any JSON value
 * @param ttlSeconds Seconds until the token expires
 * @returns The token
 */
export async function seal(purpose: string, value: unknown, ttlSeconds: number): Promise<string> {
  const envelope: Envelope<unknown> = { value, expiresAt: Date.now() + ttlSeconds * 1000 };
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(purpose) },
    await getKey(),
    new TextEncoder().encode(JSON.stringify(envelope)),
  );
  const bytes = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(ciphertext), IV_BYTES);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * The value of a token, or `undefined` when the token is malformed, forged, for another purpose or
 * expired
 * @param purpose The purpose the token was sealed for
 * @param token The token
 */
export async function open<T>(purpose: string, token: string): Promise<T | undefined> {
  if (!/^[\w-]+$/.test(token)) return undefined;
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length <= IV_BYTES) return undefined;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, IV_BYTES), additionalData: new TextEncoder().encode(purpose) },
      await getKey(),
      bytes.subarray(IV_BYTES),
    );
    const envelope = JSON.parse(new TextDecoder().decode(plaintext)) as Envelope<T>;
    return envelope.expiresAt > Date.now() ? envelope.value : undefined;
  } catch {
    return undefined;
  }
}
