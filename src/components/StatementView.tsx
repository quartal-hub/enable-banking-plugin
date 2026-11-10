import type { ReactNode } from "react";
import type { AccountStatement } from "../tools/model/BankingModel.ts";

/** ISO 20022 cash account type codes, as readable labels */
const ACCOUNT_TYPES: Record<string, string> = {
  CACC: "Current account",
  CARD: "Card account",
  SVGS: "Savings account",
  LOAN: "Loan account",
  CASH: "Cash account",
  TRAN: "Transaction account",
};

/** Styles Bootstrap does not cover; everything else comes from the skin's Bootstrap classes */
const CSS = `
.q-statement .num { font-variant-numeric: tabular-nums; }
@media print {
  .q-statement tr { break-inside: avoid; }
  .q-statement .bg-body-tertiary, .q-statement .table-light { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;

/**
 * An account statement (tiliote) as a document: header, summary, transactions with the running
 * balance, pending transactions and notes. Presentational only, so it renders the same in the
 * widget and on the server-rendered print page; styled with Bootstrap classes from the skin.
 */
export default function StatementView(props: {
  statement: AccountStatement;
  /** Buttons shown above the statement (not printed) */
  actions?: ReactNode;
}) {
  const s = props.statement;
  const money = (amount: string) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency: s.currency }).format(Number(amount));
  const date = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  const type = s.account.type ? (ACCOUNT_TYPES[s.account.type] ?? s.account.type) : "Account";
  const amountClass = (amount: string) => `num text-end text-nowrap${Number(amount) < 0 ? " text-danger" : ""}`;
  const summary: [string, string][] = [
    ["Opening balance", s.openingBalance],
    ["Money in", s.totalIn],
    ["Money out", s.totalOut],
    ["Net change", s.netChange],
    ["Closing balance", s.closingBalance],
  ];

  return (
    <div className="q-statement p-3">
      <style>{CSS}</style>
      {props.actions ? <div className="d-flex flex-wrap align-items-center gap-2 mb-3 d-print-none">{props.actions}</div> : null}

      <div className="d-flex flex-wrap justify-content-between gap-3 border-bottom border-2 pb-2 mb-3">
        <div>
          <h1 className="h4 mb-1">Account statement</h1>
          <div>
            {date(s.periodStart)} – {date(s.periodEnd)}
          </div>
        </div>
        <div>
          <div className="fw-semibold">{s.account.name ?? "Account"}</div>
          <div>
            {type}
            {s.account.iban ? ` · ${s.account.iban.replace(/(.{4})/g, "$1 ").trim()}` : ""}
          </div>
          <div className="text-body-secondary">Currency {s.currency}</div>
        </div>
      </div>

      <div className="row row-cols-2 row-cols-md-5 g-2 mb-3">
        {summary.map(([label, amount]) => (
          <div className="col" key={label}>
            <div className="bg-body-tertiary rounded p-2 h-100">
              <div className="small text-body-secondary">{label}</div>
              <div className="num fw-semibold">{money(amount)}</div>
            </div>
          </div>
        ))}
      </div>

      <table className="table table-sm align-top">
        <thead>
          <tr>
            <th>Date</th>
            <th>Transaction</th>
            <th className="text-end">Amount</th>
            <th className="text-end">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="table-light fw-semibold">
            <td>{date(s.periodStart)}</td>
            <td>Opening balance</td>
            <td />
            <td className="num text-end text-nowrap">{money(s.openingBalance)}</td>
          </tr>
          {s.lines.map((line, i) => (
            <tr key={`${line.reference ?? ""}-${i}`}>
              <td className="text-nowrap">{date(line.date)}</td>
              <td>
                {line.counterparty ?? line.description ?? "—"}
                {line.description && line.description !== line.counterparty ? (
                  <div className="small text-body-secondary">{line.description}</div>
                ) : null}
              </td>
              <td className={amountClass(line.amount)}>{money(line.amount)}</td>
              <td className="num text-end text-nowrap">{money(line.balance)}</td>
            </tr>
          ))}
          {s.lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-body-secondary">
                No transactions in this period.
              </td>
            </tr>
          ) : null}
          <tr className="table-light fw-semibold">
            <td>{date(s.periodEnd)}</td>
            <td>Closing balance</td>
            <td />
            <td className="num text-end text-nowrap">{money(s.closingBalance)}</td>
          </tr>
        </tbody>
      </table>

      {s.pending.length > 0 ? (
        <>
          <h2 className="h6 mt-4">Pending transactions (not in the balances)</h2>
          <table className="table table-sm">
            <tbody>
              {s.pending.map((t, i) => {
                const when = t.bookingDate ?? t.valueDate;
                return (
                  <tr key={`${t.reference ?? ""}-p${i}`}>
                    <td className="text-nowrap">{when ? date(when) : "—"}</td>
                    <td>{t.counterparty ?? t.description ?? "—"}</td>
                    <td className={amountClass(t.amount)}>{money(t.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}

      <div className="small text-body-secondary mt-3">
        {s.notes.map((note) => (
          <div key={note}>{note}</div>
        ))}
        <div>Generated {new Date(s.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC.</div>
      </div>
    </div>
  );
}
