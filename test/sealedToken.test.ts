import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open, seal } from "../src/enable-banking/SealedToken.ts";

beforeEach(() => {
  vi.stubEnv("ENABLE_BANKING_PRIVATE_KEY", "test-private-key");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("sealed tokens", () => {
  it("round-trips a value without showing it in the token", async () => {
    const token = await seal("print", { accountId: "acc-a" }, 600);
    expect(token).toMatch(/^[\w-]+$/);
    expect(token).not.toContain("acc-a");
    expect(await open("print", token)).toEqual({ accountId: "acc-a" });
  });

  it("refuses a token for another purpose", async () => {
    const token = await seal("print", { accountId: "acc-a" }, 600);
    expect(await open("authorization", token)).toBeUndefined();
  });

  it("refuses a tampered token", async () => {
    const token = await seal("print", { accountId: "acc-a" }, 600);
    const bytes = Buffer.from(token, "base64url");
    bytes[bytes.length - 1] ^= 1;
    expect(await open("print", bytes.toString("base64url"))).toBeUndefined();
  });

  it("refuses malformed tokens", async () => {
    expect(await open("print", "")).toBeUndefined();
    expect(await open("print", "not a token")).toBeUndefined();
    expect(await open("print", "abc")).toBeUndefined();
  });

  it("refuses an expired token", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const token = await seal("print", { accountId: "acc-a" }, 600);
    vi.setSystemTime(Date.now() + 599 * 1000);
    expect(await open("print", token)).toEqual({ accountId: "acc-a" });
    vi.setSystemTime(Date.now() + 2 * 1000);
    expect(await open("print", token)).toBeUndefined();
  });

  it("refuses a token sealed with another private key", async () => {
    const token = await seal("print", { accountId: "acc-a" }, 600);
    vi.stubEnv("ENABLE_BANKING_PRIVATE_KEY", "another-private-key");
    expect(await open("print", token)).toBeUndefined();
  });
});
