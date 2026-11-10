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
