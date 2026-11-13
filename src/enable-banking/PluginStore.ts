import { Helpers } from "@quartal/plugin";
import { createStorage, type Driver, type Storage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import redisDriver from "unstorage/drivers/redis";

/** A stored value and when it expires */
interface Entry<T> {
  value: T;
  /** Epoch milliseconds, absent for no expiry */
  expiresAt?: number;
}

/**
 * The plugin's short-lived key-value store: started bank authorizations and the connections the
 * callback parks until the user's next tool call. Keys are `:`-separated segments; every segment
 * must be a UUID, a hash or another value of letters, digits and `-` only.
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
 * The store, unless another one was set with `setPluginStore`: Redis at `REDIS_URL` when it is
 * set, shared by every server instance; otherwise this instance's memory, which is enough for one
 * local process. Its data lives at most 30 minutes.
 * @throws On Vercel without `REDIS_URL`: there the bank callback and the user's tool calls can run
 * on different instances, so a memory store would make bank connects fail.
 */
export function getPluginStore(): PluginStore {
  const global = globalThis as Record<string, unknown>;
  global[GLOBAL_KEY] ??= unstoragePluginStore(createStorage({ driver: storeDriver() }));
  return global[GLOBAL_KEY] as PluginStore;
}

/** The unstorage driver for `getPluginStore` */
function storeDriver(): Driver {
  const url = Helpers.getEnvVar("REDIS_URL");
  if (url) return redisDriver({ url, base: "enable-banking", scanCount: 1000 });
  if (Helpers.getEnvVar("VERCEL")) {
    throw new Error("REDIS_URL is not set: connect the Redis store to the Vercel project (Storage → Connect Project).");
  }
  return memoryDriver();
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
