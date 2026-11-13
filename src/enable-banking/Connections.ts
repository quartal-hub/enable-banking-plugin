import type { QuartalPluginContext } from "@quartal/plugin";
import type { Account, Connection } from "../tools/model/BankingModel.ts";
import { getConnectionStore } from "./ConnectionStore.ts";
import { enableBankingRequest } from "./EnableBankingClient.ts";
import { connectionEndedError, EnableBankingError, unknownAccountError } from "./EnableBankingError.ts";

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

/** A new connection, before it is saved */
export type NewConnection = Omit<StoredConnection, "connectionId" | "status" | "connectedAt">;

/** A tool call's context with a logged-in user */
export type UserContext = QuartalPluginContext & { uid: string };

/**
 * The logged-in user's context
 * @param ctx The tool call's context
 */
export function requireUser(ctx: QuartalPluginContext | undefined): UserContext {
  if (!ctx?.uid) {
    throw new Error("Not logged in. The bank tools need a logged-in user; log in to the plugin and try again.");
  }
  return ctx as UserContext;
}

/**
 * The user's connections, oldest first. Connections whose bank access has run out are dropped
 * (the store has no expiry of its own).
 * @param ctx The logged-in user
 */
export async function listStoredConnections(ctx: UserContext): Promise<StoredConnection[]> {
  const store = getConnectionStore(ctx);
  const stored = await store.load();
  const now = Date.now();
  const current = stored.filter((c) => c.uid === ctx.uid && Date.parse(c.validUntil) > now);
  if (current.length !== stored.length) await store.save(current);
  return current.sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
}

/**
 * Changes the user's connections
 * @param ctx The logged-in user
 * @param change Returns the new list from the current one
 */
async function updateConnections(
  ctx: UserContext,
  change: (connections: StoredConnection[]) => StoredConnection[],
): Promise<void> {
  const connections = await listStoredConnections(ctx);
  await getConnectionStore(ctx).save(change(connections));
}

/**
 * Stores a new connection. An earlier connection of the user to the same bank, country and
 * customer type is replaced, and its session closed at Enable Banking. Saving the same session
 * again (e.g. from two concurrent tool calls) changes nothing.
 * @param ctx The logged-in user, who must be the connection's user
 * @param data The connection
 * @returns The stored connection
 */
export async function saveConnection(ctx: UserContext, data: NewConnection): Promise<StoredConnection> {
  if (data.uid !== ctx.uid) throw new Error("A connection can only be saved by its own user.");
  const connections = await listStoredConnections(ctx);
  const existing = connections.find((c) => c.sessionId === data.sessionId);
  if (existing) return existing;

  const replaced = connections.filter(
    (c) => c.bank === data.bank && c.country === data.country && c.psuType === data.psuType,
  );
  for (const old of replaced) {
    // Best effort: a failure to close the old session must not lose the new connection.
    await closeSession(old).catch((e: unknown) => {
      console.warn(`Could not close the replaced session of connection ${old.connectionId}:`, e);
    });
  }
  const connection: StoredConnection = {
    ...data,
    connectionId: crypto.randomUUID(),
    status: "active",
    connectedAt: new Date().toISOString(),
  };
  await updateConnections(ctx, (current) => [
    ...current.filter((c) => !replaced.some((r) => r.connectionId === c.connectionId)),
    connection,
  ]);
  return connection;
}

/**
 * One of the user's connections, or `undefined`
 * @param ctx The logged-in user
 * @param connectionId The connection id
 */
export async function findConnection(ctx: UserContext, connectionId: string): Promise<StoredConnection | undefined> {
  return (await listStoredConnections(ctx)).find((c) => c.connectionId === connectionId);
}

/**
 * The user's connection that has an account, or `undefined` when the account is not the user's
 * @param ctx The logged-in user
 * @param accountId Account `uid`
 */
export async function findAccountConnection(ctx: UserContext, accountId: string): Promise<StoredConnection | undefined> {
  const connections = await listStoredConnections(ctx);
  // Newest first: after a reconnect, an account id belongs to the new connection.
  return connections.reverse().find((c) => c.accounts.some((a) => a.uid === accountId));
}

/**
 * The user's active connection that has an account. Throws "unknown account" when the account is
 * not the user's, the same error as for an account id that does not exist at all.
 * @param ctx The logged-in user
 * @param accountId Account `uid`
 */
export async function requireAccountConnection(ctx: UserContext, accountId: string): Promise<StoredConnection> {
  const connection = await findAccountConnection(ctx, accountId);
  if (!connection) throw unknownAccountError();
  if (connection.status === "ended") throw connectionEndedError(connection.bank);
  return connection;
}

/**
 * Runs Enable Banking calls for a connection; when Enable Banking says the session has ended,
 * marks the connection `ended` before rethrowing, so `listConnections` shows it
 * @param ctx The logged-in user
 * @param connection The connection
 * @param fn The calls
 */
export async function withConnection<T>(ctx: UserContext, connection: StoredConnection, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EnableBankingError && e.sessionEnded) {
      await updateConnections(ctx, (current) =>
        current.map((c) => (c.connectionId === connection.connectionId ? { ...c, status: "ended" } : c)),
      );
    }
    throw e;
  }
}

/**
 * Closes a connection's session at Enable Banking (best effort: a session that has already ended
 * is fine) and deletes the stored connection
 * @param ctx The logged-in user
 * @param connection The connection
 */
export async function removeConnection(ctx: UserContext, connection: StoredConnection): Promise<void> {
  await closeSession(connection);
  await updateConnections(ctx, (current) => current.filter((c) => c.connectionId !== connection.connectionId));
}

/**
 * Closes a connection's session at Enable Banking; a session that has already ended is fine
 * @param connection The connection
 */
async function closeSession(connection: StoredConnection): Promise<void> {
  try {
    await enableBankingRequest("DELETE", `/sessions/${encodeURIComponent(connection.sessionId)}`);
  } catch (e) {
    if (!(e instanceof EnableBankingError && e.sessionEnded)) throw e;
  }
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
