import { Helpers } from "@quartal/plugin";
import { createStorage, type Storage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";

/** A stored value and when it expires */
interface Entry<T> {
  value: T;
  /** Epoch milliseconds, absent for no expiry */
  expiresAt?: number;
}

/**
 * The plugin's persistent key-value store: pending authorizations, bank connections and print
 * tokens. Keys are `:`-separated segments; every segment must be a UUID, a hash or another value
 * of letters, digits and `-` only.
 */
export interface PluginStore {
  /**
   * The value of a key, or `undefined` when it is missing or expired
   * @param key The key
   */
  get<T>(key: string): Promise<T | undefined>;
  /**
   * Stores a value
   * @param key The key
   * @param value Any JSON value
   * @param ttlSeconds Seconds until the value expires; absent for no expiry
   */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  /**
   * Removes a key
   * @param key The key
   */
  remove(key: string): Promise<void>;
  /**
   * The keys under a prefix, e.g. `connections:<user>`
   * @param prefix The prefix, without a trailing `:`
   */
  keys(prefix: string): Promise<string[]>;
}

/**
 * A `PluginStore` over an [unstorage](https://unstorage.unjs.io) storage. Expiry is checked on
 * read, so it works with drivers without TTL support (such as `fs`); the TTL is also passed to
 * the driver, so drivers with TTL support (Redis, Cloudflare KV) delete expired values themselves.
 * @param storage The storage
 */
export function unstoragePluginStore(storage: Storage): PluginStore {
  return {
    async get<T>(key: string) {
      const entry = await storage.getItem<Entry<T>>(key);
      if (!entry) return undefined;
      if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
        await storage.removeItem(key);
        return undefined;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      const expiresAt = ttlSeconds === undefined ? undefined : Date.now() + ttlSeconds * 1000;
      await storage.setItem<Entry<unknown>>(key, { value, expiresAt }, ttlSeconds ? { ttl: ttlSeconds } : {});
    },
    async remove(key) {
      await storage.removeItem(key);
    },
    async keys(prefix) {
      return storage.getKeys(prefix);
    },
  };
}

// On globalThis so the tool modules and the Astro pages share one store even if the dev server
// loads this module more than once.
const GLOBAL_KEY = "__enableBankingStore";

/**
 * The store: files under `ENABLE_BANKING_DATA_DIR` (default `.data`) unless another one was set
 * with `setPluginStore`. The `fs` driver suits one Node.js process with a persistent disk; for
 * several instances or serverless hosting, set a shared store (e.g. unstorage's Redis or
 * Cloudflare KV driver) here.
 */
export function getPluginStore(): PluginStore {
  const global = globalThis as Record<string, unknown>;
  global[GLOBAL_KEY] ??= unstoragePluginStore(
    createStorage({ driver: fsDriver({ base: Helpers.getEnvVar("ENABLE_BANKING_DATA_DIR") ?? ".data" }) }),
  );
  return global[GLOBAL_KEY] as PluginStore;
}

/**
 * Replaces the store, e.g. with an in-memory one in tests
 * @param store The new store
 */
export function setPluginStore(store: PluginStore): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = store;
}

/**
 * A store key segment for a value that may contain any characters (a user id, Enable Banking's
 * authorization id): its SHA-256 as hex
 * @param value The value
 */
export async function hashKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
