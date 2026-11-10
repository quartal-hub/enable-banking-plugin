/** A bank (ASPSP) available through Enable Banking */
export interface Bank {
  /** Bank name, as used in `startAuthorization` */
  name: string;
  /** Two-letter country code */
  country: string;
  /** Logo URL */
  logo?: string;
  /** Customer types the bank supports, e.g. `personal`, `business` */
  psuTypes?: string[];
}

/** A started bank authorization */
export interface AuthorizationStart {
  /** URL the user opens to log in to the bank and approve access */
  url: string;
  /** Enable Banking's id for this authorization */
  authorizationId: string;
}

/** The outcome of a bank authorization started with `startAuthorization` */
export interface AuthorizationResult {
  /**
   * `pending` until the user has finished at the bank, then `connected` or `failed`;
   * `notFound` when the id is not recognized or has expired (results are kept for 30 minutes)
   */
  // "notFound" rather than "unknown": @quartal/plugin 1.0.0 generates a broken output schema for
  // string literals spelled like TypeScript keywords. See "Framework workarounds" in
  // docs/bank-connection.md.
  status: "pending" | "connected" | "failed" | "notFound";
  /** Bank name */
  bank?: string;
  /** Session id for `listAccounts`, once connected */
  sessionId?: string;
  /** The accounts the user granted access to, once connected */
  accounts?: Account[];
  /** What went wrong, when failed */
  error?: string;
}

/** A bank account the user has granted access to */
export interface Account {
  /** Account id (session-specific) */
  uid: string;
  /** IBAN, when the bank reports one */
  iban?: string;
  /** Account name */
  name?: string;
  /** Account currency */
  currency?: string;
  /** Account type code, e.g. `CACC` (current account) or `CARD` (card account) */
  type?: string;
}

/** One account transaction */
export interface Transaction {
  /** Amount as a signed decimal string: negative for money out, positive for money in */
  amount: string;
  /** Currency code */
  currency: string;
  /**
   * Date the transaction was booked
   * @format date
   */
  bookingDate?: string;
  /**
   * Value date
   * @format date
   */
  valueDate?: string;
  /** The other party: the payee for money out, the payer for money in */
  counterparty?: string;
  /** Message or reference text */
  description?: string;
  /** `BOOK` (booked) or `PDNG` (pending) */
  status?: string;
  /** The bank's reference for the transaction */
  reference?: string;
}

/** One page of transactions */
export interface TransactionPage {
  /** The transactions, in the order the bank returns them (usually newest first) */
  transactions: Transaction[];
  /** Pass to `listTransactions` to get the next page; absent on the last page */
  continuationKey?: string;
}

/** An account statement (tiliote) for a period */
export interface AccountStatement {
  /** The account */
  account: Account;
  /** Currency of all amounts */
  currency: string;
  /**
   * First day of the period
   * @format date
   */
  periodStart: string;
  /**
   * Last day of the period (at most the date of the bank's current balance)
   * @format date
   */
  periodEnd: string;
  /** Balance before the first day of the period, as a decimal string */
  openingBalance: string;
  /** Balance at the end of the last day of the period */
  closingBalance: string;
  /** Sum of money in during the period (positive) */
  totalIn: string;
  /** Sum of money out during the period (positive) */
  totalOut: string;
  /** Closing balance minus opening balance */
  netChange: string;
  /** Booked transactions of the period, oldest first, each with the balance after it */
  lines: StatementLine[];
  /** Pending (not yet booked) transactions; not included in the balances */
  pending: Transaction[];
  /** Remarks about how the statement was calculated, for the reader */
  notes: string[];
  /**
   * When the statement was produced
   * @format date-time
   */
  generatedAt: string;
}

/** A short-lived link to the printable account statement page */
export interface StatementPrintLink {
  /** URL of the printable statement; opens the print dialog */
  url: string;
}

/** One booked transaction on an account statement */
export interface StatementLine {
  /**
   * Booking date
   * @format date
   */
  date: string;
  /** The other party: the payee for money out, the payer for money in */
  counterparty?: string;
  /** Message or reference text */
  description?: string;
  /** Signed amount: negative for money out */
  amount: string;
  /** Balance after this transaction */
  balance: string;
  /** The bank's reference for the transaction */
  reference?: string;
}

/** One balance of an account */
export interface Balance {
  /** Balance name given by the bank */
  name?: string;
  /** Balance type code, e.g. `CLBD` (closing booked) or `ITAV` (interim available) */
  type: string;
  /** Amount as a decimal string */
  amount: string;
  /** Currency code */
  currency: string;
  /**
   * Date the balance applies to
   * @format date
   */
  referenceDate?: string;
}
