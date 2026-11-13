import type { QuartalPluginContext } from "@quartal/plugin";
import type { Account, Connection } from "../tools/model/BankingModel.ts";
import { enableBankingRequest } from "./EnableBankingClient.ts";
import { connectionEndedError, EnableBankingError, unknownAccountError } from "./EnableBankingError.ts";
import { getPluginStore, hashKey } from "./PluginStore.ts";

/**
 * A bank connection of a user, as stored. The session id is a bank-data credential for whoever
 * holds the application key: it stays on the server and never reaches the model.
 */
export interface StoredConnection {
  connectionId: string;
  /** The user's id (`ctx.uid`) */
  uid: string;
  /** Enable Banking session id */
  sessionId: string;
  bank: string;
  country: string;
  psuType: string;
  accounts: Account[];
  status: "active" | "ended";
  /** ISO date-time */
  validUntil: string;
  /** ISO date-time */
  connectedAt: string;
}

/**
 * The logged-in user's id
 * @param ctx The tool call's context
 */
export function requireUid(ctx: QuartalPluginContext | undefined): string {
  if (!ctx?.uid) {
    throw new Error("Not logged in. The bank tools need a logged-in user; log in to the plugin and try again.");
  }
  return ctx.uid;
}

/**
 * Key prefix of a user's connections
 * @param uid The user's id
 */
async function userPrefix(uid: string): Promise<string> {
  return `connections:${await hashKey(uid)}`;
}

/**
 * Stores a new connection. An earlier connection of the user to the same bank, country and
 * customer type is replaced, and its session closed at Enable Banking.
 * @param data The connection without its id, status and creation time
 */
export async function saveConnection(
  data: Omit<StoredConnection, "connectionId" | "status" | "connectedAt">,
): Promise<StoredConnection> {
  const connection: StoredConnection = {
    ...data,
    connectionId: crypto.randomUUID(),
    status: "active",
    connectedAt: new Date().toISOString(),
  };
  for (const old of await listStoredConnections(data.uid)) {
    if (old.bank === data.bank && old.country === data.country && old.psuType === data.psuType) {
      // Best effort: a failure to close the old session must not lose the new connection.
      await removeConnection(old).catch(async (e: unknown) => {
        console.warn(`Could not close the replaced session of connection ${old.connectionId}:`, e);
        await deleteStoredConnection(old);
      });
    }
  }
  await putConnection(connection);
  return connection;
}

/**
 * Writes a connection, expiring when its bank access ends
 * @param connection The connection
 */
async function putConnection(connection: StoredConnection): Promise<void> {
  const ttl = Math.floor((Date.parse(connection.validUntil) - Date.now()) / 1000);
  if (ttl <= 0) return;
  await getPluginStore().set(`${await userPrefix(connection.uid)}:${connection.connectionId}`, connection, ttl);
}

/**
 * The user's stored connections, oldest first
 * @param uid The user's id
 */
export async function listStoredConnections(uid: string): Promise<StoredConnection[]> {
  const store = getPluginStore();
  const keys = await store.keys(await userPrefix(uid));
  const connections = await Promise.all(keys.map((key) => store.get<StoredConnection>(key)));
  return connections
    .filter((c): c is StoredConnection => c?.uid === uid)
    .sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
}

/**
 * One of the user's connections, or `undefined`
 * @param uid The user's id
 * @param connectionId The connection id
 */
export async function findConnection(uid: string, connectionId: string): Promise<StoredConnection | undefined> {
  if (!/^[\w-]+$/.test(connectionId)) return undefined;
  const connection = await getPluginStore().get<StoredConnection>(`${await userPrefix(uid)}:${connectionId}`);
  return connection?.uid === uid ? connection : undefined;
}

/**
 * The user's connection that has an account, or `undefined` when the account is not the user's
 * @param uid The user's id
 * @param accountId Account `uid`
 */
export async function findAccountConnection(uid: string, accountId: string): Promise<StoredConnection | undefined> {
  const connections = await listStoredConnections(uid);
  // Newest first: after a reconnect, an account id belongs to the new connection.
  return connections.reverse().find((c) => c.accounts.some((a) => a.uid === accountId));
}

/**
 * The user's active connection that has an account. Throws "unknown account" when the account is
 * not the user's, the same error as for an account id that does not exist at all.
 * @param uid The user's id
 * @param accountId Account `uid`
 */
export async function requireAccountConnection(uid: string, accountId: string): Promise<StoredConnection> {
  const connection = await findAccountConnection(uid, accountId);
  if (!connection) throw unknownAccountError();
  if (connection.status === "ended") throw connectionEndedError(connection.bank);
  return connection;
}

/**
 * Runs Enable Banking calls for a connection; when Enable Banking says the session has ended,
 * marks the connection `ended` before rethrowing, so `listConnections` shows it
 * @param connection The connection
 * @param fn The calls
 */
export async function withConnection<T>(connection: StoredConnection, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EnableBankingError && e.sessionEnded) {
      await putConnection({ ...connection, status: "ended" });
    }
    throw e;
  }
}

/**
 * Closes a connection's session at Enable Banking (best effort: a session that has already ended
 * is fine) and deletes the stored connection
 * @param connection The connection
 */
export async function removeConnection(connection: StoredConnection): Promise<void> {
  try {
    await enableBankingRequest("DELETE", `/sessions/${encodeURIComponent(connection.sessionId)}`);
  } catch (e) {
    if (!(e instanceof EnableBankingError && e.sessionEnded)) throw e;
  }
  await deleteStoredConnection(connection);
}

/**
 * Deletes a stored connection, leaving its session at Enable Banking as it is
 * @param connection The connection
 */
async function deleteStoredConnection(connection: StoredConnection): Promise<void> {
  await getPluginStore().remove(`${await userPrefix(connection.uid)}:${connection.connectionId}`);
}

/**
 * A stored connection as the tools show it, without the session id
 * @param c The connection
 */
export function toConnection(c: StoredConnection): Connection {
  return {
    connectionId: c.connectionId,
    bank: c.bank,
    country: c.country,
    status: c.status,
    validUntil: c.validUntil,
    connectedAt: c.connectedAt,
    accountCount: c.accounts.length,
  };
}
