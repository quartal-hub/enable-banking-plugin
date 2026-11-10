import { describe, expect, it } from "vitest";
import { buildAccountStatement, type StatementInput } from "../src/enable-banking/buildAccountStatement.ts";
import type { Balance, Transaction } from "../src/tools/model/BankingModel.ts";

// The Mock ASPSP test account used in development: an opening balance of 1240.00 before
// 1 October 2026, 20 booked transactions up to 9 November, and the bank's booked balance of
// 5216.72 on 9 November.
const ROWS: [string, string, string][] = [
  ["2026-10-01", "3150.00", "Palkka / Salary Acme Oy"],
  ["2026-10-02", "-950.00", "Vuokra / Rent Asunto Oy Kotikatu"],
  ["2026-10-03", "-64.90", "K-Supermarket Kamppi"],
  ["2026-10-04", "-12.50", "HSL Mobiili"],
  ["2026-10-05", "-38.20", "Prisma Itäkeskus"],
  ["2026-10-06", "-45.00", "Helen Oy sähkö"],
  ["2026-10-07", "-9.99", "Spotify"],
  ["2026-10-08", "-27.40", "Ravintola Sea Horse"],
  ["2026-10-09", "-71.35", "S-market Hakaniemi"],
  ["2026-10-25", "120.00", "MobilePay Matti V."],
  ["2026-10-31", "3150.00", "Palkka / Salary Acme Oy"],
  ["2026-11-01", "-950.00", "Vuokra / Rent Asunto Oy Kotikatu"],
  ["2026-11-02", "-64.90", "K-Supermarket Kamppi"],
  ["2026-11-03", "-12.50", "HSL Mobiili"],
  ["2026-11-04", "-38.20", "Prisma Itäkeskus"],
  ["2026-11-05", "-45.00", "Helen Oy sähkö"],
  ["2026-11-06", "-9.99", "Spotify"],
  ["2026-11-07", "-27.40", "Ravintola Sea Horse"],
  ["2026-11-08", "-71.35", "S-market Hakaniemi"],
  ["2026-11-09", "-4.60", "R-kioski"],
];

const transaction = (date: string, amount: string, counterparty: string, extra: Partial<Transaction> = {}): Transaction => ({
  amount,
  currency: "EUR",
  bookingDate: date,
  counterparty,
  status: "BOOK",
  ...extra,
});

const balance = (type: string, amount: string): Balance => ({
  type,
  amount,
  currency: "EUR",
  referenceDate: "2026-11-09",
});

/** The statement input for a period; `overrides` replaces any part of it */
const input = (dateFrom: string, dateTo: string, overrides: Partial<StatementInput> = {}): StatementInput => ({
  account: { uid: "acc-1", name: "Oliver Mäkinen", iban: "FI2112345600000785", currency: "EUR", type: "CACC" },
  // Newest first, as banks usually return them: the calculation must not depend on the order.
  transactions: ROWS.map(([d, a, c]) => transaction(d, a, c)).reverse(),
  balances: [balance("CLBD", "5216.72")],
  complete: true,
  dateFrom,
  dateTo,
  today: "2026-11-09",
  ...overrides,
});

describe("buildAccountStatement", () => {
  it("works the October balances back from the current balance", () => {
    const s = buildAccountStatement(input("2026-10-01", "2026-10-31"));
    expect(s.openingBalance).toBe("1240.00");
    expect(s.closingBalance).toBe("6440.66");
    expect(s.totalIn).toBe("6420.00");
    expect(s.totalOut).toBe("1219.34");
    expect(s.netChange).toBe("5200.66");
    expect(s.periodEnd).toBe("2026-10-31");
  });

  it("lists the period's transactions oldest first with the running balance", () => {
    const s = buildAccountStatement(input("2026-10-01", "2026-10-31"));
    expect(s.lines).toHaveLength(11);
    expect(s.lines[0]).toMatchObject({ date: "2026-10-01", amount: "3150.00", balance: "4390.00" });
    expect(s.lines[1]).toMatchObject({ date: "2026-10-02", amount: "-950.00", balance: "3440.00" });
    expect(s.lines.at(-1)).toMatchObject({ date: "2026-10-31", balance: s.closingBalance });
  });

  it("chains consecutive months and ends a period at the balance date", () => {
    const october = buildAccountStatement(input("2026-10-01", "2026-10-31"));
    const november = buildAccountStatement(input("2026-11-01", "2026-11-30"));
    expect(november.openingBalance).toBe(october.closingBalance);
    expect(november.closingBalance).toBe("5216.72");
    expect(november.periodEnd).toBe("2026-11-09");
    expect(november.notes).toContain("The period ends on 2026-11-09, the date of the bank's balance.");
  });

  it("keeps pending transactions out of the balances", () => {
    const pending = transaction("2026-10-15", "-500.00", "Pending purchase", { status: "PDNG" });
    const s = buildAccountStatement(input("2026-10-01", "2026-10-31", { transactions: [...input("", "").transactions, pending] }));
    expect(s.pending).toEqual([pending]);
    expect(s.lines.some((l) => l.counterparty === "Pending purchase")).toBe(false);
    expect(s.closingBalance).toBe("6440.66");
  });

  it("calculates from the booked balance, not the available one", () => {
    const s = buildAccountStatement(
      input("2026-10-01", "2026-10-31", { balances: [balance("ITAV", "9999.99"), balance("CLBD", "5216.72")] }),
    );
    expect(s.closingBalance).toBe("6440.66");
  });

  it("falls back to an available balance when there is no booked one", () => {
    const s = buildAccountStatement(input("2026-10-01", "2026-10-31", { balances: [balance("ITAV", "5216.72")] }));
    expect(s.closingBalance).toBe("6440.66");
  });

  it("warns when not all transaction pages could be fetched", () => {
    const s = buildAccountStatement(input("2026-10-01", "2026-10-31", { complete: false }));
    expect(s.notes).toContain("Not all transactions could be fetched; the balances may be incomplete.");
  });

  it("leaves out transactions in another currency and says so", () => {
    const sek = { ...transaction("2026-10-10", "-100.00", "Stockholm"), currency: "SEK" };
    const s = buildAccountStatement(input("2026-10-01", "2026-10-31", { transactions: [...input("", "").transactions, sek] }));
    expect(s.lines).toHaveLength(11);
    expect(s.closingBalance).toBe("6440.66");
    expect(s.notes).toContain("1 transaction(s) in another currency were left out.");
  });

  // Amounts with two decimals: 0.10 + 0.20 must print as 0.30, not 0.30000000000000004.
  it("adds decimal amounts exactly", () => {
    const s = buildAccountStatement(
      input("2026-11-10", "2026-11-10", {
        today: "2026-11-10",
        balances: [{ ...balance("CLBD", "0.30"), referenceDate: "2026-11-10" }],
        transactions: [transaction("2026-11-10", "0.10", "A"), transaction("2026-11-10", "0.20", "B")],
      }),
    );
    expect(s.openingBalance).toBe("0.00");
    expect(s.totalIn).toBe("0.30");
    expect(s.lines.map((l) => l.balance)).toEqual(["0.10", "0.30"]);
  });

  it("returns an empty statement for a period without transactions", () => {
    const s = buildAccountStatement(input("2026-09-01", "2026-09-30"));
    expect(s.lines).toEqual([]);
    expect(s.openingBalance).toBe("1240.00");
    expect(s.closingBalance).toBe("1240.00");
  });

  it("refuses an account without any reported balance", () => {
    expect(() => buildAccountStatement(input("2026-10-01", "2026-10-31", { balances: [] }))).toThrow(
      "The bank reports no balance for this account",
    );
  });
});
