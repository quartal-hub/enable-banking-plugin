import type { QuartalPluginContext } from "@quartal/plugin";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeAuthorization,
  getPendingAuthorization,
  linkAuthorizationId,
  createAuthorizationState,
} from "../src/enable-banking/AuthorizationStore.ts";
import {
  CONNECTIONS_SECRET,
  secretConnectionStore,
  setConnectionStoreFactory,
} from "../src/enable-banking/ConnectionStore.ts";
import {
  listStoredConnections,
  type NewConnection,
  saveConnection,
  type StoredConnection,
  type UserContext,
} from "../src/enable-banking/Connections.ts";
import { EnableBankingError } from "../src/enable-banking/EnableBankingError.ts";
import { resolvePrintToken } from "../src/enable-banking/PrintLinks.ts";
import { setPluginStore, unstoragePluginStore } from "../src/enable-banking/PluginStore.ts";
import { EnableBanking } from "../src/tools/EnableBanking.ts";

// Enable Banking API calls, answered per test
const request = vi.hoisted(() => vi.fn());
vi.mock("../src/enable-banking/EnableBankingClient.ts", () => ({ enableBankingRequest: request }));

const alice: UserContext = { uid: "alice", authenticated: true };
const bob: UserContext = { uid: "bob", authenticated: true };
const inNinetyDays = () => new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

/** A new connection of a user to a bank with one account */
function newConnection(uid: string, accountId: string, bank = "Mock ASPSP"): NewConnection {
  return {
    uid,
    sessionId: `session-${accountId}`,
    bank,
    country: "FI",
    psuType: "personal",
    accounts: [{ uid: accountId, name: "Current account", currency: "EUR", type: "CACC" }],
    validUntil: inNinetyDays(),
  };
}

/** Connects a bank for a user directly in their connection store */
async function connect(ctx: UserContext, accountId: string, bank = "Mock ASPSP") {
  return saveConnection(ctx, newConnection(ctx.uid, accountId, bank));
}

/** Each user's connections, as JSON like in a Quartal Hub secret */
let saved: Map<string, string>;

beforeEach(() => {
  saved = new Map();
  setConnectionStoreFactory((ctx) => ({
    load: () => Promise.resolve(JSON.parse(saved.get(ctx.uid ?? "") ?? "[]") as StoredConnection[]),
    save: (connections) => {
      saved.set(ctx.uid ?? "", JSON.stringify(connections));
      return Promise.resolve();
    },
  }));
  setPluginStore(unstoragePluginStore(createStorage({ driver: memoryDriver() })));
  request.mockReset();
  // Print tokens are encrypted with a key derived from it
  vi.stubEnv("ENABLE_BANKING_PRIVATE_KEY", "test-private-key");
});

afterEach(() => {
  setConnectionStoreFactory(undefined);
  vi.unstubAllEnvs();
});

describe("per-user connections", () => {
  it("lists only the user's own connections and accounts", async () => {
    await connect(alice, "acc-a");
    expect(await EnableBanking.listAccounts({}, alice)).toMatchObject([{ uid: "acc-a", bank: "Mock ASPSP" }]);
    expect(await EnableBanking.listAccounts({}, bob)).toEqual([]);
    expect(await EnableBanking.listConnections(undefined, bob)).toEqual([]);
  });

  it("refuses another user's account id in every account tool", async () => {
    await connect(alice, "acc-a");
    request.mockResolvedValue({ balances: [], transactions: [] });
    const input = { accountId: "acc-a", dateFrom: "2026-10-01", dateTo: "2026-10-31" };
    await expect(EnableBanking.getBalances(input, bob)).rejects.toThrow("Unknown account id");
    await expect(EnableBanking.listTransactions(input, bob)).rejects.toThrow("Unknown account id");
    await expect(EnableBanking.getAccountStatement(input, bob)).rejects.toThrow("Unknown account id");
    await expect(EnableBanking.createStatementPrintLink(input, bob)).rejects.toThrow("Unknown account id");
    expect(request).not.toHaveBeenCalled();

    await expect(EnableBanking.getBalances(input, alice)).resolves.toEqual([]);
  });

  it("requires a logged-in user", async () => {
    const anonymous: QuartalPluginContext = { authenticated: false };
    await expect(EnableBanking.listAccounts({}, anonymous)).rejects.toThrow("Not logged in");
    await expect(EnableBanking.listConnections(undefined, undefined)).rejects.toThrow("Not logged in");
  });

  it("does not let another user disconnect a bank", async () => {
    const { connectionId } = await connect(alice, "acc-a");
    await expect(EnableBanking.disconnectBank({ connectionId }, bob)).rejects.toThrow("Unknown connection id");
    expect(await listStoredConnections(alice)).toHaveLength(1);

    request.mockResolvedValue(undefined);
    await EnableBanking.disconnectBank({ connectionId }, alice);
    expect(request).toHaveBeenCalledWith("DELETE", "/sessions/session-acc-a");
    expect(await listStoredConnections(alice)).toEqual([]);
  });

  it("replaces an earlier connection to the same bank", async () => {
    request.mockResolvedValue(undefined);
    await connect(alice, "acc-old");
    await connect(alice, "acc-new");
    expect((await EnableBanking.listAccounts({}, alice)).map((a) => a.uid)).toEqual(["acc-new"]);
    expect(request).toHaveBeenCalledWith("DELETE", "/sessions/session-acc-old");
  });

  it("marks a connection ended when Enable Banking says the session has ended", async () => {
    await connect(alice, "acc-a");
    request.mockRejectedValue(new EnableBankingError("The bank connection has ended", true));
    await expect(EnableBanking.getBalances({ accountId: "acc-a" }, alice)).rejects.toThrow("has ended");

    expect(await EnableBanking.listConnections(undefined, alice)).toMatchObject([{ status: "ended" }]);
    expect(await EnableBanking.listAccounts({}, alice)).toEqual([]);
    request.mockReset();
    await expect(EnableBanking.getBalances({ accountId: "acc-a" }, alice)).rejects.toThrow(
      "connection to Mock ASPSP has ended",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("binds print tokens to the user", async () => {
    await connect(alice, "acc-a");
    const { url } = await EnableBanking.createStatementPrintLink(
      { accountId: "acc-a", dateFrom: "2026-10-01", dateTo: "2026-10-31" },
      alice,
    );
    const token = new URL(url).searchParams.get("token") ?? "";
    expect(await resolvePrintToken(token)).toEqual({
      uid: "alice",
      accountId: "acc-a",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      bank: "Mock ASPSP",
    });
    expect(token).not.toContain("acc-a");
    expect(await resolvePrintToken("not-a-token")).toBeUndefined();
  });
});

describe("authorizations", () => {
  it("shows an authorization's result only to the user who started it, without a session id", async () => {
    const state = await createAuthorizationState({
      uid: "alice",
      bank: "Mock ASPSP",
      country: "FI",
      psuType: "personal",
      validUntil: inNinetyDays(),
    });
    await linkAuthorizationId(state, "auth-1");
    expect(await EnableBanking.getAuthorizationResult({ authorizationId: "auth-1" }, alice)).toMatchObject({
      status: "pending",
    });

    await completeAuthorization(state, newConnection("alice", "acc-a"));
    const result = await EnableBanking.getAuthorizationResult({ authorizationId: "auth-1" }, alice);
    expect(result).toMatchObject({ status: "connected", bank: "Mock ASPSP", accounts: [{ uid: "acc-a" }] });
    expect(JSON.stringify(result)).not.toContain("session-acc-a");
    expect(await EnableBanking.getAuthorizationResult({ authorizationId: "auth-1" }, bob)).toEqual({
      status: "notFound",
    });
    // The callback URL works once.
    expect(await getPendingAuthorization(state)).toBeUndefined();
  });

  it("stores the user and the requested access with the started authorization", async () => {
    request.mockResolvedValue({ url: "https://bank.example/login", authorization_id: "auth-2" });
    const start = await EnableBanking.startAuthorization({ bank: "Mock ASPSP", country: "fi" }, alice);
    expect(start).toEqual({ url: "https://bank.example/login", authorizationId: "auth-2" });
    const { state } = (request.mock.calls[0] as [string, string, { state: string }])[2];
    expect(await getPendingAuthorization(state)).toMatchObject({
      uid: "alice",
      country: "FI",
      psuType: "personal",
      authorizationId: "auth-2",
    });
  });
});

describe("plugin store", () => {
  it("drops expired values on read", async () => {
    const store = unstoragePluginStore(createStorage({ driver: memoryDriver() }));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await store.set("authorizations:s1", { status: "pending" }, 600);
      expect(await store.get("authorizations:s1")).toEqual({ status: "pending" });
      vi.setSystemTime(Date.now() + 601 * 1000);
      expect(await store.get("authorizations:s1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("connections from the callback", () => {
  /** Starts an authorization for a user and completes it as the callback does */
  async function completeAtBank(uid: string, accountId: string, authorizationId: string) {
    const state = await createAuthorizationState({
      uid,
      bank: "Mock ASPSP",
      country: "FI",
      psuType: "personal",
      validUntil: inNinetyDays(),
    });
    await linkAuthorizationId(state, authorizationId);
    await completeAuthorization(state, newConnection(uid, accountId));
  }

  it("saves a completed connection at the user's next tool call", async () => {
    await completeAtBank("alice", "acc-a", "auth-1");
    expect(saved.get("alice")).toBeUndefined();

    expect(await EnableBanking.listAccounts({}, alice)).toMatchObject([{ uid: "acc-a" }]);
    expect(JSON.parse(saved.get("alice") ?? "[]")).toMatchObject([{ sessionId: "session-acc-a" }]);
  });

  it("does not save a connection for another user", async () => {
    await completeAtBank("alice", "acc-a", "auth-1");
    expect(await EnableBanking.listAccounts({}, bob)).toEqual([]);
    expect(saved.get("bob")).toBeUndefined();
    expect(await EnableBanking.listAccounts({}, alice)).toMatchObject([{ uid: "acc-a" }]);
  });

  it("saves once and keeps the session when concurrent tool calls claim it", async () => {
    await completeAtBank("alice", "acc-a", "auth-1");
    await Promise.all([
      EnableBanking.getAuthorizationResult({ authorizationId: "auth-1" }, alice),
      EnableBanking.listAccounts({}, alice),
    ]);
    expect(await listStoredConnections(alice)).toHaveLength(1);
    expect(request).not.toHaveBeenCalledWith("DELETE", "/sessions/session-acc-a");
  });

  it("still reports the result after the connection is saved", async () => {
    await completeAtBank("alice", "acc-a", "auth-1");
    await EnableBanking.listConnections(undefined, alice);
    expect(await EnableBanking.getAuthorizationResult({ authorizationId: "auth-1" }, alice)).toMatchObject({
      status: "connected",
      accounts: [{ uid: "acc-a" }],
    });
  });
});

describe("connection store", () => {
  it("drops connections whose bank access has run out", async () => {
    await connect(alice, "acc-a");
    const expired = { ...newConnection("alice", "acc-old", "Old Bank"), validUntil: "2020-01-01T00:00:00Z" };
    const stored = JSON.parse(saved.get("alice") ?? "[]") as StoredConnection[];
    saved.set("alice", JSON.stringify([...stored, { ...expired, connectionId: "c-old", status: "active", connectedAt: "2019-12-01T00:00:00Z" }]));

    expect((await listStoredConnections(alice)).map((c) => c.bank)).toEqual(["Mock ASPSP"]);
    expect(JSON.parse(saved.get("alice") ?? "[]")).toHaveLength(1);
  });

  it("keeps the connections in one Quartal Hub secret without bank details in its metadata", async () => {
    const secrets = new Map<string, { kind: string; value: string; metadata?: Record<string, unknown> }>();
    const store = secretConnectionStore({
      get: (name) => {
        const s = secrets.get(name);
        return Promise.resolve(s ? ({ name, ...s } as never) : null);
      },
      put: (name, secret) => {
        secrets.set(name, secret);
        return Promise.resolve({ name } as never);
      },
      delete: (name) => Promise.resolve(secrets.delete(name)),
    });
    expect(await store.load()).toEqual([]);

    const connection = { ...newConnection("alice", "acc-a"), connectionId: "c1", status: "active" as const, connectedAt: "2026-11-13T00:00:00Z" };
    await store.save([connection]);
    expect(secrets.get(CONNECTIONS_SECRET)).toMatchObject({ kind: "enable-banking-connections", metadata: { count: 1 } });
    expect(await store.load()).toEqual([connection]);

    await store.save([]);
    expect(secrets.has(CONNECTIONS_SECRET)).toBe(false);
  });
});
