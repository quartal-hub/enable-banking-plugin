import type { QuartalPluginContext } from "@quartal/plugin";
import { getExperimentalHubContext, type HubSecrets } from "@quartal/plugin/hub";
import type { StoredConnection } from "./Connections.ts";

/**
 * Where one user's bank connections are kept. A store belongs to the user of the tool call it was
 * made for.
 */
export interface ConnectionStore {
  /** The user's connections, as last saved */
  load(): Promise<StoredConnection[]>;
  /**
   * Replaces the user's connections
   * @param connections All of the user's connections
   */
  save(connections: StoredConnection[]): Promise<void>;
}

/** Name of the Quartal Hub secret that holds a user's connections */
export const CONNECTIONS_SECRET = "enable-banking.connections";

/**
 * A `ConnectionStore` in one Quartal Hub secret of the user: the connections as a JSON array.
 * The secret's metadata has only the count, no bank or account details.
 * @param secrets The user's Quartal Hub secrets
 */
export function secretConnectionStore(secrets: Pick<HubSecrets, "get" | "put" | "delete">): ConnectionStore {
  return {
    async load() {
      const secret = await secrets.get(CONNECTIONS_SECRET);
      return secret ? (JSON.parse(secret.value) as StoredConnection[]) : [];
    },
    async save(connections) {
      if (connections.length === 0) {
        await secrets.delete(CONNECTIONS_SECRET);
        return;
      }
      await secrets.put(CONNECTIONS_SECRET, {
        kind: "enable-banking-connections",
        value: JSON.stringify(connections),
        metadata: { count: connections.length },
      });
    },
  };
}

type ConnectionStoreFactory = (ctx: QuartalPluginContext) => ConnectionStore;

// On globalThis so the tool modules and the Astro pages share one factory even if the dev server
// loads this module more than once.
const GLOBAL_KEY = "__enableBankingConnectionStoreFactory";

/** The default: the user's Quartal Hub secrets, through the experimental Hub context */
const hubSecretsFactory: ConnectionStoreFactory = (ctx) => secretConnectionStore(getExperimentalHubContext(ctx).secrets);

/**
 * The connection store of a tool call's user
 * @param ctx The tool call's context, with the user's access token
 */
export function getConnectionStore(ctx: QuartalPluginContext): ConnectionStore {
  const factory = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as ConnectionStoreFactory | undefined;
  return (factory ?? hubSecretsFactory)(ctx);
}

/**
 * Replaces where connections are kept, e.g. with an in-memory store in tests
 * @param factory Makes the store of a tool call's user; `undefined` restores Quartal Hub secrets
 */
export function setConnectionStoreFactory(factory: ConnectionStoreFactory | undefined): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = factory;
}
