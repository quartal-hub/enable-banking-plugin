import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QuartalPluginContext } from "@quartal/plugin";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import memoryDriver from "unstorage/drivers/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeAuthorization,
  getPendingAuthorization,
  linkAuthorizationId,
  createAuthorizationState,
} from "../src/enable-banking/AuthorizationStore.ts";
import { listStoredConnections, saveConnection } from "../src/enable-banking/Connections.ts";
import { EnableBankingError } from "../src/enable-banking/EnableBankingError.ts";
import { resolvePrintToken } from "../src/enable-banking/PrintLinks.ts";
import { setPluginStore, unstoragePluginStore } from "../src/enable-banking/PluginStore.ts";
import { EnableBanking } from "../src/tools/EnableBanking.ts";

// Enable Banking API calls, answered per test
const request = vi.hoisted(() => vi.fn());
vi.mock("../src/enable-banking/EnableBankingClient.ts", () => ({ enableBankingRequest: request }));

const alice: QuartalPluginContext = { uid: "alice", authenticated: true };
const bob: QuartalPluginContext = { uid: "bob", authenticated: true };
const inNinetyDays = () => new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

/** Connects a bank for a user directly in the store, as the callback does */
async function connect(uid: string, accountId: string, bank = "Mock ASPSP") {
  return saveConnection({
    uid,
    sessionId: `session-${accountId}`,
    bank,
    country: "FI",
    psuType: "personal",
    accounts: [{ uid: accountId, name: "Current account", currency: "EUR", type: "CACC" }],
    validUntil: inNinetyDays(),
  });
}

beforeEach(() => {
  setPluginStore(unstoragePluginStore(createStorage({ driver: memoryDriver() })));
  request.mockReset();
  // Print tokens are encrypted with a key derived from it
  vi.stubEnv("ENABLE_BANKING_PRIVATE_KEY", "test-private-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("per-user connections", () => {
  it("lists only the user's own connections and accounts", async () => {
    await connect("alice", "acc-a");
    expect(await EnableBanking.listAccounts({}, alice)).toMatchObject([{ uid: "acc-a", bank: "Mock ASPSP" }]);
    expect(await EnableBanking.listAccounts({}, bob)).toEqual([]);
    expect(await EnableBanking.listConnections(undefined, bob)).toEqual([]);
  });

  it("refuses another user's account id in every account tool", async () => {
    await connect("alice", "acc-a");
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
    const { connectionId } = await connect("alice", "acc-a");
    await expect(EnableBanking.disconnectBank({ connectionId }, bob)).rejects.toThrow("Unknown connection id");
    expect(await listStoredConnections("alice")).toHaveLength(1);

    request.mockResolvedValue(undefined);
    await EnableBanking.disconnectBank({ connectionId }, alice);
    expect(request).toHaveBeenCalledWith("DELETE", "/sessions/session-acc-a");
    expect(await listStoredConnections("alice")).toEqual([]);
  });

  it("replaces an earlier connection to the same bank", async () => {
    request.mockResolvedValue(undefined);
    await connect("alice", "acc-old");
    await connect("alice", "acc-new");
    expect((await EnableBanking.listAccounts({}, alice)).map((a) => a.uid)).toEqual(["acc-new"]);
    expect(request).toHaveBeenCalledWith("DELETE", "/sessions/session-acc-old");
  });

  it("marks a connection ended when Enable Banking says the session has ended", async () => {
    await connect("alice", "acc-a");
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
    await connect("alice", "acc-a");
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

    await completeAuthorization(state, [{ uid: "acc-a" }]);
    const result = await EnableBanking.getAuthorizationResult({ authorizationId: "auth-1" }, alice);
    expect(result).toEqual({ status: "connected", bank: "Mock ASPSP", accounts: [{ uid: "acc-a" }] });
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

describe("persistent store", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "enable-banking-store-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps connections across restarts", async () => {
    setPluginStore(unstoragePluginStore(createStorage({ driver: fsDriver({ base: dir }) })));
    await connect("alice", "acc-a");
    // A new store over the same directory, as after a restart
    setPluginStore(unstoragePluginStore(createStorage({ driver: fsDriver({ base: dir }) })));
    expect(await EnableBanking.listAccounts({}, alice)).toMatchObject([{ uid: "acc-a" }]);
  });

  it("drops expired values on read", async () => {
    const store = unstoragePluginStore(createStorage({ driver: fsDriver({ base: dir }) }));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await store.set("print-tokens:t1", { accountId: "acc-a" }, 600);
      expect(await store.get("print-tokens:t1")).toEqual({ accountId: "acc-a" });
      vi.setSystemTime(Date.now() + 601 * 1000);
      expect(await store.get("print-tokens:t1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
