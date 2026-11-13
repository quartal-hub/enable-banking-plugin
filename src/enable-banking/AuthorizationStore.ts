import type { Account, AuthorizationResult } from "../tools/model/BankingModel.ts";
import { type NewConnection, saveConnection, type UserContext } from "./Connections.ts";
import { getPluginStore, hashKey } from "./PluginStore.ts";

/**
 * A started bank authorization and, once the user is back at the callback, its outcome. The
 * callback is a browser redirect without a bearer token: the user is the `uid` stored here, found
 * through the random, single-use `state` the plugin created. Without a token, the callback cannot
 * write the user's connection store either: it parks the new connection here, and the user's next
 * tool call saves it (`claimCompletedConnections`).
 */
export interface AuthorizationRecord {
  /** The user who started it (`ctx.uid`) */
  uid: string;
  /** Bank name */
  bank: string;
  /** Two-letter country code */
  country: string;
  /** `personal` or `business` */
  psuType: string;
  /** End of the requested bank access, ISO date-time */
  validUntil: string;
  /** Enable Banking's authorization id: the handle `getAuthorizationResult` is called with */
  authorizationId?: string;
  status: "pending" | "connected" | "failed";
  accounts?: Account[];
  /** The new connection, from the callback until the user's next tool call saves it */
  connection?: NewConnection;
  error?: string;
}

/** Started authorizations are kept 30 minutes */
const TTL_SECONDS = 30 * 60;

/**
 * Store key of an authorization
 * @param state The authorization's `state`
 */
function stateKey(state: string): string | undefined {
  return /^[\w-]+$/.test(state) ? `authorizations:${state}` : undefined;
}

/**
 * Store key of the index from Enable Banking's authorization id to the `state`
 * @param authorizationId Enable Banking's authorization id
 */
async function idKey(authorizationId: string): Promise<string> {
  return `authorization-ids:${await hashKey(authorizationId)}`;
}

/**
 * Records a started authorization and returns its new random `state`
 * @param data The user and the bank
 */
export async function createAuthorizationState(
  data: Pick<AuthorizationRecord, "uid" | "bank" | "country" | "psuType" | "validUntil">,
): Promise<string> {
  const state = crypto.randomUUID();
  await getPluginStore().set(`authorizations:${state}`, { ...data, status: "pending" }, TTL_SECONDS);
  return state;
}

/**
 * Links Enable Banking's authorization id to a started authorization
 * @param state The authorization's `state`
 * @param authorizationId Enable Banking's authorization id
 */
export async function linkAuthorizationId(state: string, authorizationId: string): Promise<void> {
  await update(state, { authorizationId });
  await getPluginStore().set(await idKey(authorizationId), state, TTL_SECONDS);
}

/**
 * The pending authorization for a callback's `state`, or `undefined` when it is unknown,
 * expired or already completed (so a callback URL works once)
 * @param state The `state` from the callback
 */
export async function getPendingAuthorization(state: string): Promise<AuthorizationRecord | undefined> {
  const key = stateKey(state);
  const record = key ? await getPluginStore().get<AuthorizationRecord>(key) : undefined;
  return record?.status === "pending" ? record : undefined;
}

/**
 * Store key prefix of a user's connected authorizations whose connection is not saved yet
 * @param uid The user's id
 */
async function unclaimedPrefix(uid: string): Promise<string> {
  return `unclaimed:${await hashKey(uid)}`;
}

/**
 * Marks an authorization as connected and parks its new connection until the user's next tool
 * call saves it
 * @param state The authorization's `state`
 * @param connection The new connection
 */
export async function completeAuthorization(state: string, connection: NewConnection): Promise<void> {
  await update(state, { status: "connected", accounts: connection.accounts, connection });
  await getPluginStore().set(`${await unclaimedPrefix(connection.uid)}:${state}`, state, TTL_SECONDS);
}

/**
 * Saves the user's parked connections (see `completeAuthorization`) to their connection store and
 * drops the session ids from the authorization records
 * @param ctx The logged-in user
 */
export async function claimCompletedConnections(ctx: UserContext): Promise<void> {
  const store = getPluginStore();
  const prefix = await unclaimedPrefix(ctx.uid);
  for (const key of await store.keys(prefix)) {
    const state = key.slice(prefix.length + 1);
    const record = stateKey(state) ? await store.get<AuthorizationRecord>(`authorizations:${state}`) : undefined;
    if (record?.connection && record.uid === ctx.uid) {
      // Saving the same session twice changes nothing, so a concurrent claim is harmless.
      await saveConnection(ctx, record.connection);
      await update(state, { connection: undefined });
    }
    await store.remove(key);
  }
}

/**
 * Marks an authorization as failed
 * @param state The authorization's `state`
 * @param error What went wrong
 */
export async function failAuthorization(state: string, error: string): Promise<void> {
  await update(state, { status: "failed", error });
}

/**
 * The current outcome of one of the user's authorizations, looked up by Enable Banking's
 * authorization id. Another user's authorization is `notFound`.
 * @param uid The user's id
 * @param authorizationId The id `startAuthorization` returned
 */
export async function findAuthorizationResult(uid: string, authorizationId: string): Promise<AuthorizationResult> {
  const store = getPluginStore();
  const state = await store.get<string>(await idKey(authorizationId));
  const key = state ? stateKey(state) : undefined;
  const record = key ? await store.get<AuthorizationRecord>(key) : undefined;
  if (!record || record.uid !== uid || record.authorizationId !== authorizationId) return { status: "notFound" };
  const { status, bank, accounts, error } = record;
  return { status, bank, accounts, error };
}

/**
 * Changes fields of a stored authorization; it then expires 30 minutes after the change
 * @param state The authorization's `state`
 * @param changes The changed fields
 */
async function update(state: string, changes: Partial<AuthorizationRecord>): Promise<void> {
  const key = stateKey(state);
  const store = getPluginStore();
  const record = key ? await store.get<AuthorizationRecord>(key) : undefined;
  if (key && record) await store.set(key, { ...record, ...changes }, TTL_SECONDS);
}
