import { LRUCache } from "lru-cache";
import type { Account, AuthorizationResult } from "../tools/model/BankingModel.ts";

/** A started bank authorization and, once the user is back at the callback, its outcome */
interface AuthorizationRecord {
  /** Bank name, for the callback page */
  bank: string;
  /** Enable Banking's authorization id: the handle `getAuthorizationResult` is called with */
  authorizationId?: string;
  status: "pending" | "connected" | "failed";
  sessionId?: string;
  accounts?: Account[];
  error?: string;
}

// Started bank authorizations, keyed by the random `state` sent to the bank: the callback only
// accepts redirects this plugin started, and stores their outcome for `getAuthorizationResult`.
// Entries expire 30 minutes after the authorization was started, and at most 1000 are kept. On
// globalThis so the tool modules and the callback page share one cache even if the dev server
// loads this module more than once. In-memory only: fine for a single local process; several
// instances or serverless functions need a shared store instead.
const store = ((globalThis as Record<string, unknown>).__enableBankingAuthorizations ??= new LRUCache<
  string,
  AuthorizationRecord
>({ max: 1000, ttl: 30 * 60 * 1000 })) as LRUCache<string, AuthorizationRecord>;

/**
 * Records a started authorization and returns its new random `state`
 * @param bank Bank name
 */
export function createAuthorizationState(bank: string): string {
  const state = crypto.randomUUID();
  store.set(state, { bank, status: "pending" });
  return state;
}

/**
 * Links Enable Banking's authorization id to a started authorization
 * @param state The authorization's `state`
 * @param authorizationId Enable Banking's authorization id
 */
export function linkAuthorizationId(state: string, authorizationId: string): void {
  const record = store.get(state);
  if (record) record.authorizationId = authorizationId;
}

/**
 * The pending authorization for a callback's `state`, or `undefined` when it is unknown,
 * expired or already completed (so a callback URL works once)
 * @param state The `state` from the callback
 */
export function getPendingAuthorization(state: string): AuthorizationRecord | undefined {
  const record = store.get(state);
  return record?.status === "pending" ? record : undefined;
}

/**
 * Stores the session of a completed authorization
 * @param state The authorization's `state`
 * @param sessionId The new Enable Banking session id
 * @param accounts The session's accounts
 */
export function completeAuthorization(state: string, sessionId: string, accounts: Account[]): void {
  const record = store.get(state);
  if (record) Object.assign(record, { status: "connected", sessionId, accounts });
}

/**
 * Marks an authorization as failed
 * @param state The authorization's `state`
 * @param error What went wrong
 */
export function failAuthorization(state: string, error: string): void {
  const record = store.get(state);
  if (record) Object.assign(record, { status: "failed", error });
}

/**
 * The current outcome of an authorization, looked up by Enable Banking's authorization id
 * @param authorizationId The id `startAuthorization` returned
 */
export function findAuthorizationResult(authorizationId: string): AuthorizationResult {
  for (const record of store.values()) {
    if (record.authorizationId !== authorizationId) continue;
    const { status, bank, sessionId, accounts, error } = record;
    return { status, bank, sessionId, accounts, error };
  }
  return { status: "notFound" };
}
